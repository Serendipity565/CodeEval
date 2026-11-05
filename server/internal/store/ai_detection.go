package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"codeeval/server/internal/domain"
	"gorm.io/gorm/clause"
)

// One current report per immutable submission; successful regeneration replaces it.
type AIDetectionRecord struct {
	SubmissionID uint      `gorm:"primaryKey;autoIncrement:false"`
	AssignmentID uint      `gorm:"index;not null"`
	ResultJSON   []byte    `gorm:"type:json;not null"`
	GeneratedAt  time.Time `gorm:"not null"`
	UpdatedAt    time.Time
}

func (AIDetectionRecord) TableName() string { return "ai_detection_records" }

// The API checks teacher ownership before calling this method. Repeat the
// assignment scope here, and never include attempts made after the target.
func (s *MySQLStore) AIDetectionContext(ctx context.Context, assignmentID, submissionID uint) (domain.AIDetectionContext, error) {
	db := s.db.WithContext(ctx)
	var target SubmissionRecord
	if err := db.Where("id = ? AND assignment_id = ?", submissionID, assignmentID).First(&target).Error; err != nil {
		return domain.AIDetectionContext{}, err
	}
	material := domain.AIDetectionContext{}
	if len(target.EvaluationJSON) > 0 {
		var evaluation domain.Evaluation
		if err := json.Unmarshal(target.EvaluationJSON, &evaluation); err != nil {
			return material, fmt.Errorf("decode AI detection execution context: %w", err)
		}
		material.Execution = evaluation.Execution
	}
	var previous []SubmissionRecord
	err := db.Select("id", "code", "submitted_at").
		Where("assignment_id = ? AND student_id = ?", assignmentID, target.StudentID).
		Where("submitted_at < ? OR (submitted_at = ? AND id < ?)", target.SubmittedAt, target.SubmittedAt, target.ID).
		Order("submitted_at desc, id desc").Limit(3).Find(&previous).Error
	if err != nil {
		return material, err
	}
	for _, row := range previous {
		material.History = append(material.History, domain.Submission{ID: fmt.Sprint(row.ID), Code: row.Code, SubmittedAt: row.SubmittedAt})
	}
	return material, nil
}

// SavedAIDetections reads metadata only, without the similarity batch/code limits.
func (s *MySQLStore) SavedAIDetections(ctx context.Context, assignmentID, teacherID, submissionID uint) ([]domain.AIDetection, error) {
	db := s.db.WithContext(ctx)
	var assignment AssignmentRecord
	if err := db.Select("id").Where("id = ? AND teacher_id = ?", assignmentID, teacherID).First(&assignment).Error; err != nil {
		return nil, err
	}
	if submissionID != 0 {
		var submission SubmissionRecord
		if err := db.Select("id").Where("id = ? AND assignment_id = ?", submissionID, assignmentID).First(&submission).Error; err != nil {
			return nil, err
		}
		return s.AIDetectionResults(ctx, assignmentID, []string{fmt.Sprint(submissionID)})
	}
	latest := db.Model(&SubmissionRecord{}).Select("id").Where("assignment_id = ?", assignmentID).
		Where("NOT EXISTS (SELECT 1 FROM submission_records AS newer WHERE newer.assignment_id = submission_records.assignment_id AND newer.student_id = submission_records.student_id AND (newer.submitted_at > submission_records.submitted_at OR (newer.submitted_at = submission_records.submitted_at AND newer.id > submission_records.id)))")
	var rows []AIDetectionRecord
	if err := db.Where("assignment_id = ? AND submission_id IN (?)", assignmentID, latest).Order("submission_id asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	return decodeAIDetectionReports(rows)
}

// Callers authorize assignment ownership and submission membership before access.
func (s *MySQLStore) AIDetectionResults(ctx context.Context, assignmentID uint, submissionIDs []string) ([]domain.AIDetection, error) {
	results := make([]domain.AIDetection, 0)
	if len(submissionIDs) == 0 {
		return results, nil
	}
	var rows []AIDetectionRecord
	if err := s.db.WithContext(ctx).Where("assignment_id = ? AND submission_id IN ?", assignmentID, submissionIDs).Order("submission_id asc").Find(&rows).Error; err != nil {
		return nil, err
	}
	return decodeAIDetectionReports(rows)
}

func decodeAIDetectionReports(rows []AIDetectionRecord) ([]domain.AIDetection, error) {
	results := make([]domain.AIDetection, 0, len(rows))
	for _, row := range rows {
		var result domain.AIDetection
		if err := json.Unmarshal(row.ResultJSON, &result); err != nil {
			return nil, fmt.Errorf("decode saved AI detection: %w", err)
		}
		result.SubmissionID = fmt.Sprint(row.SubmissionID)
		results = append(results, result)
	}
	return results, nil
}

func (s *MySQLStore) SaveAIDetection(ctx context.Context, assignmentID, submissionID uint, result domain.AIDetection) error {
	result.SubmissionID = fmt.Sprint(submissionID)
	data, err := json.Marshal(result)
	if err != nil {
		return err
	}
	row := AIDetectionRecord{SubmissionID: submissionID, AssignmentID: assignmentID, ResultJSON: data, GeneratedAt: result.GeneratedAt}
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{
		Columns:   []clause.Column{{Name: "submission_id"}},
		DoUpdates: clause.AssignmentColumns([]string{"result_json", "generated_at", "updated_at"}),
	}).Create(&row).Error
}
