package store

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"codeeval/server/internal/config"
	"codeeval/server/internal/domain"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
)

type User struct {
	ID           uint   `gorm:"primaryKey"`
	Username     string `gorm:"uniqueIndex;size:80"`
	DisplayName  string
	PasswordHash string
	Role         string `gorm:"size:16;index"`
	CreatedAt    time.Time
}
type AssignmentRecord struct {
	ID                   uint `gorm:"primaryKey"`
	TeacherID            uint `gorm:"index"`
	Title, Language      string
	Description          string `gorm:"type:text"`
	ReferenceSolution    string `gorm:"type:longtext"`
	KnowledgeBase        string `gorm:"type:longtext"`
	Status               string `gorm:"size:16;not null;default:open;index"`
	MaxSubmissions       int    `gorm:"not null;default:1"`
	DueAt                time.Time
	RubricJSON           []byte `gorm:"type:json"`
	LLMEvaluationEnabled bool   `gorm:"not null;default:false"`
	CreatedAt            time.Time
}
type SubmissionRecord struct {
	ID             uint   `gorm:"primaryKey"`
	AssignmentID   uint   `gorm:"index"`
	StudentID      uint   `gorm:"index"`
	Code           string `gorm:"type:longtext"`
	Status         string
	Progress       int
	EvaluationJSON []byte `gorm:"type:json"`
	SubmittedAt    time.Time
}
type MySQLStore struct{ db *gorm.DB }

func NewMySQL(cfg config.Config) (*MySQLStore, error) {
	dsn := fmt.Sprintf("%s:%s@tcp(%s:%d)/%s?charset=%s&parseTime=True&loc=Local&timeout=10s&readTimeout=30s&writeTimeout=30s",
		cfg.Database.Username, cfg.Database.Password, cfg.Database.Host, cfg.Database.Port, cfg.Database.Name, cfg.Database.Charset)
	db, err := gorm.Open(mysql.Open(dsn), &gorm.Config{})
	if err != nil {
		return nil, fmt.Errorf("connect mysql: %w", err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		return nil, fmt.Errorf("get mysql connection pool: %w", err)
	}
	sqlDB.SetMaxIdleConns(cfg.Database.MaxIdleConns)
	sqlDB.SetMaxOpenConns(cfg.Database.MaxOpenConns)
	sqlDB.SetConnMaxLifetime(time.Duration(cfg.Database.ConnMaxLifetimeMinutes) * time.Minute)
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := sqlDB.PingContext(ctx); err != nil {
		return nil, fmt.Errorf("ping mysql: %w", err)
	}
	if err := db.AutoMigrate(&User{}, &AssignmentRecord{}, &SubmissionRecord{}); err != nil {
		return nil, fmt.Errorf("migrate mysql: %w", err)
	}
	return &MySQLStore{db: db}, nil
}
func (s *MySQLStore) FindUser(username string) (User, error) {
	var u User
	return u, s.db.Where("username = ?", username).First(&u).Error
}
func (s *MySQLStore) CreateUser(u User) error { return s.db.Create(&u).Error }
func (s *MySQLStore) CreateAssignment(teacherID uint, a domain.Assignment) (domain.Assignment, error) {
	b, e := json.Marshal(a.Rubric)
	if e != nil {
		return a, e
	}
	r := AssignmentRecord{TeacherID: teacherID, Title: a.Title, Language: a.Language, Description: a.Description, ReferenceSolution: a.ReferenceSolution, KnowledgeBase: a.KnowledgeBase, Status: a.Status, MaxSubmissions: a.MaxSubmissions, DueAt: a.DueAt, RubricJSON: b, LLMEvaluationEnabled: a.LLMEvaluationEnabled}
	e = s.db.Create(&r).Error
	a.ID = fmt.Sprint(r.ID)
	a.HasReferenceMaterial = strings.TrimSpace(a.ReferenceSolution) != "" || strings.TrimSpace(a.KnowledgeBase) != ""
	return a, e
}
func (s *MySQLStore) ListAssignments() (out []domain.Assignment, err error) {
	out = make([]domain.Assignment, 0)
	var rows []AssignmentRecord
	err = s.db.Order("due_at asc").Find(&rows).Error
	if err != nil {
		return out, err
	}
	var users []User
	if err = s.db.Where("role = ?", "teacher").Find(&users).Error; err != nil {
		return out, err
	}
	teacherNames := make(map[uint]string, len(users))
	for _, user := range users {
		teacherNames[user.ID] = user.DisplayName
	}
	for _, r := range rows {
		assignment := assignmentFrom(r)
		assignment.TeacherName = teacherNames[r.TeacherID]
		out = append(out, assignment)
	}
	return
}
func (s *MySQLStore) Assignment(id uint) (domain.Assignment, error) {
	var r AssignmentRecord
	err := s.db.First(&r, id).Error
	assignment := assignmentFrom(r)
	if err == nil {
		var teacher User
		if teacherErr := s.db.First(&teacher, r.TeacherID).Error; teacherErr == nil {
			assignment.TeacherName = teacher.DisplayName
		}
	}
	return assignment, err
}
func (s *MySQLStore) UpdateAssignmentStatus(id, teacherID uint, status string) error {
	result := s.db.Model(&AssignmentRecord{}).Where("id = ? AND teacher_id = ?", id, teacherID).Update("status", status)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
func (s *MySQLStore) UpdateAssignmentMaxSubmissions(id, teacherID uint, maxSubmissions int) error {
	result := s.db.Model(&AssignmentRecord{}).Where("id = ? AND teacher_id = ?", id, teacherID).Update("max_submissions", maxSubmissions)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
func (s *MySQLStore) CreateSubmission(studentID uint, sub domain.Submission) (domain.Submission, error) {
	eval, _ := json.Marshal(sub.Evaluation)
	r := SubmissionRecord{AssignmentID: mustID(sub.AssignmentID), StudentID: studentID, Code: sub.Code, Status: sub.Status, Progress: sub.Progress, EvaluationJSON: eval, SubmittedAt: sub.SubmittedAt}
	err := s.db.Create(&r).Error
	sub.ID = fmt.Sprint(r.ID)
	return sub, err
}
func (s *MySQLStore) UpdateSubmissionProgress(id uint, status string, progress int) error {
	return s.db.Model(&SubmissionRecord{}).Where("id = ?", id).Updates(map[string]any{"status": status, "progress": progress}).Error
}
func (s *MySQLStore) CompleteSubmission(id uint, evaluation domain.Evaluation) error {
	data, err := json.Marshal(evaluation)
	if err != nil {
		return err
	}
	return s.db.Model(&SubmissionRecord{}).Where("id = ?", id).Updates(map[string]any{"status": evaluation.Status, "progress": 100, "evaluation_json": data}).Error
}
func (s *MySQLStore) SubmissionCount(studentID, assignmentID uint) (int64, error) {
	var count int64
	err := s.db.Model(&SubmissionRecord{}).Where("student_id = ? AND assignment_id = ?", studentID, assignmentID).Count(&count).Error
	return count, err
}
func (s *MySQLStore) SubmissionHistory(studentID, assignmentID uint, limit int) ([]domain.Submission, error) {
	var rows []SubmissionRecord
	q := s.db.Where("student_id = ? AND assignment_id = ? AND evaluation_json IS NOT NULL", studentID, assignmentID).Order("submitted_at desc")
	if limit > 0 {
		q = q.Limit(limit)
	}
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Submission, 0, len(rows))
	for _, row := range rows {
		out = append(out, submissionFrom(row, ""))
	}
	return out, nil
}
func (s *MySQLStore) ListSubmissions(userID uint, role string) (out []domain.Submission, err error) {
	out = make([]domain.Submission, 0)
	var rows []SubmissionRecord
	q := s.db.Order("submitted_at desc")
	if role == "student" {
		q = q.Where("student_id = ?", userID)
	}
	err = q.Find(&rows).Error
	var users []User
	s.db.Find(&users)
	names := map[uint]string{}
	for _, u := range users {
		names[u.ID] = u.DisplayName
	}
	for _, r := range rows {
		out = append(out, submissionFrom(r, names[r.StudentID]))
	}
	return
}
func assignmentFrom(r AssignmentRecord) domain.Assignment {
	rubric := make([]domain.RubricItem, 0)
	_ = json.Unmarshal(r.RubricJSON, &rubric)
	if r.MaxSubmissions < 1 {
		r.MaxSubmissions = 1
	}
	if r.Status == "" {
		r.Status = "open"
	}
	return domain.Assignment{ID: fmt.Sprint(r.ID), TeacherID: fmt.Sprint(r.TeacherID), Title: r.Title, Language: r.Language, Description: r.Description, Status: r.Status, MaxSubmissions: r.MaxSubmissions, DueAt: r.DueAt, Rubric: rubric, LLMEvaluationEnabled: r.LLMEvaluationEnabled, ReferenceSolution: r.ReferenceSolution, KnowledgeBase: r.KnowledgeBase, HasReferenceMaterial: strings.TrimSpace(r.ReferenceSolution) != "" || strings.TrimSpace(r.KnowledgeBase) != ""}
}
func submissionFrom(r SubmissionRecord, name string) domain.Submission {
	var evaluation *domain.Evaluation
	if len(r.EvaluationJSON) > 0 && string(r.EvaluationJSON) != "null" {
		var e domain.Evaluation
		if json.Unmarshal(r.EvaluationJSON, &e) == nil {
			evaluation = &e
		}
	}
	return domain.Submission{ID: fmt.Sprint(r.ID), AssignmentID: fmt.Sprint(r.AssignmentID), StudentName: name, Code: r.Code, Status: r.Status, Progress: r.Progress, SubmittedAt: r.SubmittedAt, Evaluation: evaluation}
}
func mustID(raw string) uint { var id uint; _, _ = fmt.Sscan(raw, &id); return id }
