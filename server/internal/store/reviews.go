package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"codeeval/server/internal/domain"
	"golang.org/x/text/unicode/norm"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type ReviewRecord struct {
	ID             uint   `gorm:"primaryKey"`
	SubmissionID   uint   `gorm:"index;not null"`
	ReviewerID     uint   `gorm:"index;not null"`
	ReviewerName   string `gorm:"size:120;not null"`
	Comment        string `gorm:"type:text"`
	DimensionsJSON []byte `gorm:"type:json;not null"`
	Total          int
	MaxTotal       int
	CreatedAt      time.Time
}

type ExpertRatingRecord struct {
	ID              uint   `gorm:"primaryKey"`
	SubmissionID    uint   `gorm:"uniqueIndex:idx_submission_expert;not null"`
	RecordedBy      uint   `gorm:"index;not null"`
	ExpertKey       string `gorm:"size:64;uniqueIndex:idx_submission_expert;not null"`
	ExpertName      string `gorm:"size:120;not null"`
	Comment         string `gorm:"type:text"`
	DimensionsJSON  []byte `gorm:"type:json;not null"`
	Total           int
	MaxTotal        int
	DurationSeconds int
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

var (
	ErrInvalidAssessment = errors.New("评分信息不合法")
	ErrAssessmentPending = errors.New("自动评估尚未结束，请等待后再评分")
	ErrReviewConflict    = errors.New("该提交已有新的复核记录，请刷新后重新确认")
)

func validateHumanScores(evaluation *domain.Evaluation, inputs []domain.HumanScoreInput) ([]domain.HumanScore, int, int, error) {
	invalid := func(message string) ([]domain.HumanScore, int, int, error) {
		return nil, 0, 0, fmt.Errorf("%w：%s", ErrInvalidAssessment, message)
	}
	if evaluation == nil || len(evaluation.Dimensions) == 0 {
		return invalid("该提交没有可用的原始评估量规，暂不能录入人工评分")
	}
	if len(inputs) != len(evaluation.Dimensions) {
		return invalid("请完整填写原始评估中的每个评分维度")
	}
	byKey := make(map[string]*int, len(inputs))
	for _, input := range inputs {
		if _, exists := byKey[input.Key]; exists {
			return invalid("评分维度不能重复")
		}
		if input.Key == "" || input.Score == nil {
			return invalid("每个评分维度都必须明确填写整数分数，零分也需要填写")
		}
		byKey[input.Key] = input.Score
	}
	seen := make(map[string]bool, len(evaluation.Dimensions))
	scores := make([]domain.HumanScore, 0, len(evaluation.Dimensions))
	total, maxTotal := 0, 0
	for _, dimension := range evaluation.Dimensions {
		if dimension.Key == "" || seen[dimension.Key] || dimension.MaxScore < 1 || dimension.MaxScore > 100 {
			return invalid("原始评估量规不完整或无效")
		}
		seen[dimension.Key] = true
		score, found := byKey[dimension.Key]
		if !found {
			return invalid("评分维度必须与原始评估完全一致")
		}
		if *score < 0 || *score > dimension.MaxScore {
			return invalid(fmt.Sprintf("%s的分数需在 0–%d 之间", dimension.Name, dimension.MaxScore))
		}
		scores = append(scores, domain.HumanScore{Key: dimension.Key, Name: dimension.Name, Score: *score, MaxScore: dimension.MaxScore})
		total += *score
		maxTotal += dimension.MaxScore
	}
	if maxTotal > 100 || (evaluation.MaxTotal > 0 && maxTotal != evaluation.MaxTotal) {
		return invalid("原始评估的总分与维度满分不一致")
	}
	return scores, total, maxTotal, nil
}

func validateAssessmentComment(comment string) error {
	if utf8.RuneCountInString(comment) > 4000 {
		return fmt.Errorf("%w：评语不能超过 4000 个字符", ErrInvalidAssessment)
	}
	return nil
}

func normalizeExpertName(value string) (string, string, error) {
	name := strings.Join(strings.Fields(norm.NFKC.String(value)), " ")
	if size := utf8.RuneCountInString(name); size < 1 || size > 80 {
		return "", "", fmt.Errorf("%w：专家姓名需为 1–80 个字符", ErrInvalidAssessment)
	}
	hash := sha256.Sum256([]byte(strings.ToLower(name)))
	return name, hex.EncodeToString(hash[:]), nil
}

func ownedSubmissionQuery(db *gorm.DB, submissionID, teacherID uint) *gorm.DB {
	assignments := db.Model(&AssignmentRecord{}).Select("id").Where("teacher_id = ?", teacherID)
	return db.Where("id = ? AND assignment_id IN (?)", submissionID, assignments)
}

// Locking the submission serializes both review revisions and expert upserts.
func lockAssessmentSubmission(tx *gorm.DB, submissionID, teacherID uint) (SubmissionRecord, error) {
	var row SubmissionRecord
	if err := ownedSubmissionQuery(tx, submissionID, teacherID).Clauses(clause.Locking{Strength: "UPDATE"}).First(&row).Error; err != nil {
		return row, err
	}
	if row.Status != "graded" && row.Status != "needs_review" && row.Status != "failed" {
		return row, ErrAssessmentPending
	}
	var count int64
	if err := tx.Model(&EvaluationJobRecord{}).Where("submission_id = ? AND status IN ?", submissionID, []string{"queued", "running"}).Count(&count).Error; err != nil {
		return row, err
	}
	if count != 0 {
		return row, ErrAssessmentPending
	}
	return row, nil
}

func (s *MySQLStore) SubmissionAssessment(submissionID, teacherID uint) ([]domain.Review, []domain.ExpertRating, error) {
	reviews, ratings := make([]domain.Review, 0), make([]domain.ExpertRating, 0)
	var submission SubmissionRecord
	if err := ownedSubmissionQuery(s.db, submissionID, teacherID).First(&submission).Error; err != nil {
		return nil, nil, err
	}
	var reviewRows []ReviewRecord
	if err := s.db.Where("submission_id = ?", submissionID).Order("id desc").Find(&reviewRows).Error; err != nil {
		return nil, nil, err
	}
	for _, row := range reviewRows {
		item, err := reviewFrom(row)
		if err != nil {
			return nil, nil, err
		}
		reviews = append(reviews, item)
	}
	var ratingRows []ExpertRatingRecord
	if err := s.db.Where("submission_id = ?", submissionID).Order("id desc").Find(&ratingRows).Error; err != nil {
		return nil, nil, err
	}
	for _, row := range ratingRows {
		item, err := expertRatingFrom(row)
		if err != nil {
			return nil, nil, err
		}
		ratings = append(ratings, item)
	}
	return reviews, ratings, nil
}

func (s *MySQLStore) CreateReview(submissionID, teacherID uint, reviewerName string, input domain.ReviewInput) (domain.Submission, error) {
	var submission domain.Submission
	if strings.TrimSpace(input.Comment) == "" {
		return submission, fmt.Errorf("%w：请填写复核理由", ErrInvalidAssessment)
	}
	if input.ExpectedReviewID == nil {
		return submission, fmt.Errorf("%w：请提交所依据的复核版本，首次复核使用空字符串", ErrInvalidAssessment)
	}
	if err := validateAssessmentComment(input.Comment); err != nil {
		return submission, err
	}
	err := s.db.Transaction(func(tx *gorm.DB) error {
		row, err := lockAssessmentSubmission(tx, submissionID, teacherID)
		if err != nil {
			return err
		}
		submission = submissionFrom(row, "")
		dimensions, total, maxTotal, err := validateHumanScores(submission.Evaluation, input.Dimensions)
		if err != nil {
			return err
		}
		var previous []ReviewRecord
		if err := tx.Where("submission_id = ?", submissionID).Order("id desc").Limit(1).Find(&previous).Error; err != nil {
			return err
		}
		latestID := ""
		if len(previous) > 0 {
			latestID = fmt.Sprint(previous[0].ID)
		}
		if *input.ExpectedReviewID != latestID {
			return ErrReviewConflict
		}
		data, err := json.Marshal(dimensions)
		if err != nil {
			return err
		}
		record := ReviewRecord{SubmissionID: submissionID, ReviewerID: teacherID, ReviewerName: reviewerName, Comment: strings.TrimSpace(input.Comment), DimensionsJSON: data, Total: total, MaxTotal: maxTotal}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		// The automatic evaluation is deliberately left intact for comparisons.
		if err := tx.Model(&SubmissionRecord{}).Where("id = ?", submissionID).Updates(map[string]any{"status": "graded", "progress": 100}).Error; err != nil {
			return err
		}
		review, err := reviewFrom(record)
		if err != nil {
			return err
		}
		submission.Review, submission.Status, submission.Progress = &review, "graded", 100
		var student User
		if err := tx.Select("id", "display_name").First(&student, row.StudentID).Error; err != nil {
			return err
		}
		submission.StudentName = student.DisplayName
		return nil
	})
	return submission, err
}

func (s *MySQLStore) SaveExpertRating(submissionID, teacherID uint, input domain.ExpertRatingInput) (domain.ExpertRating, error) {
	var rating domain.ExpertRating
	name, key, err := normalizeExpertName(input.ExpertName)
	if err != nil {
		return rating, err
	}
	if err := validateAssessmentComment(input.Comment); err != nil {
		return rating, err
	}
	if input.DurationSeconds < 0 || input.DurationSeconds > 86400 {
		return rating, fmt.Errorf("%w：评分用时需为 0–86400 秒，0 表示未记录", ErrInvalidAssessment)
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		row, err := lockAssessmentSubmission(tx, submissionID, teacherID)
		if err != nil {
			return err
		}
		dimensions, total, maxTotal, err := validateHumanScores(submissionFrom(row, "").Evaluation, input.Dimensions)
		if err != nil {
			return err
		}
		data, err := json.Marshal(dimensions)
		if err != nil {
			return err
		}
		var existing []ExpertRatingRecord
		if err := tx.Where("submission_id = ? AND expert_key = ?", submissionID, key).Limit(1).Find(&existing).Error; err != nil {
			return err
		}
		record := ExpertRatingRecord{SubmissionID: submissionID, RecordedBy: teacherID, ExpertKey: key, ExpertName: name, Comment: strings.TrimSpace(input.Comment), DimensionsJSON: data, Total: total, MaxTotal: maxTotal, DurationSeconds: input.DurationSeconds}
		if len(existing) > 0 {
			record.ID, record.CreatedAt = existing[0].ID, existing[0].CreatedAt
			if err := tx.Save(&record).Error; err != nil {
				return err
			}
		} else if err := tx.Create(&record).Error; err != nil {
			return err
		}
		rating, err = expertRatingFrom(record)
		return err
	})
	return rating, err
}

func reviewFrom(row ReviewRecord) (domain.Review, error) {
	var dimensions []domain.HumanScore
	if err := json.Unmarshal(row.DimensionsJSON, &dimensions); err != nil {
		return domain.Review{}, fmt.Errorf("decode review %d: %w", row.ID, err)
	}
	return domain.Review{ID: fmt.Sprint(row.ID), ReviewerName: row.ReviewerName, Comment: row.Comment, Dimensions: dimensions, Total: row.Total, MaxTotal: row.MaxTotal, CreatedAt: row.CreatedAt}, nil
}

func expertRatingFrom(row ExpertRatingRecord) (domain.ExpertRating, error) {
	var dimensions []domain.HumanScore
	if err := json.Unmarshal(row.DimensionsJSON, &dimensions); err != nil {
		return domain.ExpertRating{}, fmt.Errorf("decode expert rating %d: %w", row.ID, err)
	}
	return domain.ExpertRating{ID: fmt.Sprint(row.ID), ExpertName: row.ExpertName, Comment: row.Comment, Dimensions: dimensions, Total: row.Total, MaxTotal: row.MaxTotal, DurationSeconds: row.DurationSeconds, CreatedAt: row.CreatedAt}, nil
}

func attachLatestReviews(db *gorm.DB, submissions []domain.Submission) error {
	if len(submissions) == 0 {
		return nil
	}
	ids := make([]uint, 0, len(submissions))
	for _, submission := range submissions {
		ids = append(ids, mustID(submission.ID))
	}
	// Select one revision per submission in one query, including large histories.
	latest := db.Model(&ReviewRecord{}).Select("MAX(id)").Where("submission_id IN ?", ids).Group("submission_id")
	var rows []ReviewRecord
	if err := db.Where("id IN (?)", latest).Find(&rows).Error; err != nil {
		return err
	}
	bySubmission := make(map[string]domain.Review, len(rows))
	for _, row := range rows {
		review, err := reviewFrom(row)
		if err != nil {
			return err
		}
		bySubmission[fmt.Sprint(row.SubmissionID)] = review
	}
	for i := range submissions {
		if review, ok := bySubmission[submissions[i].ID]; ok {
			submissions[i].Review = &review
		}
	}
	return nil
}

// AssignmentComparisonData exposes independent expert ratings only to the owner.
func (s *MySQLStore) AssignmentComparisonData(assignmentID, teacherID uint) ([]domain.Submission, map[string][]domain.ExpertRating, error) {
	var assignment AssignmentRecord
	if err := s.db.Where("id = ? AND teacher_id = ?", assignmentID, teacherID).First(&assignment).Error; err != nil {
		return nil, nil, err
	}
	var rows []SubmissionRecord
	if err := s.db.Where("assignment_id = ?", assignmentID).Order("submitted_at desc, id desc").Find(&rows).Error; err != nil {
		return nil, nil, err
	}
	submissions, err := submissionsWithNames(s.db, rows)
	if err != nil {
		return nil, nil, err
	}
	if err := attachLatestReviews(s.db, submissions); err != nil {
		return nil, nil, err
	}
	ratings := make(map[string][]domain.ExpertRating)
	if len(rows) == 0 {
		return submissions, ratings, nil
	}
	ids := make([]uint, 0, len(rows))
	for _, row := range rows {
		ids = append(ids, row.ID)
	}
	var expertRows []ExpertRatingRecord
	if err := s.db.Where("submission_id IN ?", ids).Order("id asc").Find(&expertRows).Error; err != nil {
		return nil, nil, err
	}
	for _, row := range expertRows {
		rating, err := expertRatingFrom(row)
		if err != nil {
			return nil, nil, err
		}
		id := fmt.Sprint(row.SubmissionID)
		ratings[id] = append(ratings[id], rating)
	}
	return submissions, ratings, nil
}

func submissionsWithNames(db *gorm.DB, rows []SubmissionRecord) ([]domain.Submission, error) {
	out := make([]domain.Submission, 0, len(rows))
	if len(rows) == 0 {
		return out, nil
	}
	studentIDs := make([]uint, 0, len(rows))
	for _, row := range rows {
		studentIDs = append(studentIDs, row.StudentID)
	}
	var users []User
	if err := db.Select("id", "display_name").Where("id IN ?", studentIDs).Find(&users).Error; err != nil {
		return nil, err
	}
	names := make(map[uint]string, len(users))
	for _, user := range users {
		names[user.ID] = user.DisplayName
	}
	for _, row := range rows {
		out = append(out, submissionFrom(row, names[row.StudentID]))
	}
	return out, nil
}
