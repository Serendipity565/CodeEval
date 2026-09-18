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
	"gorm.io/gorm/clause"
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
type TestCaseRecord struct {
	ID           uint `gorm:"primaryKey"`
	AssignmentID uint `gorm:"index;not null"`
	Name         string
	Input        string `gorm:"type:longtext"`
	Expected     string `gorm:"type:longtext"`
	Hidden       bool
	Weight       int
	TimeoutMS    int
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
type EvaluationJobRecord struct {
	ID           uint   `gorm:"primaryKey"`
	SubmissionID uint   `gorm:"uniqueIndex;not null"`
	AssignmentID uint   `gorm:"index;not null"`
	StudentID    uint   `gorm:"index;not null"`
	Status       string `gorm:"size:20;index;not null"`
	Attempts     int
	LockedBy     string `gorm:"size:80"`
	LockedAt     *time.Time
	LastError    string `gorm:"type:text"`
	CreatedAt    time.Time
	UpdatedAt    time.Time
}
type EvaluationJob struct {
	ID, SubmissionID, AssignmentID, StudentID uint
	Attempts                                  int
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
	if err := db.AutoMigrate(&User{}, &AssignmentRecord{}, &TestCaseRecord{}, &SubmissionRecord{}, &EvaluationJobRecord{}); err != nil {
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
	e = s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Create(&r).Error; err != nil {
			return err
		}
		for _, test := range a.TestCases {
			row := TestCaseRecord{AssignmentID: r.ID, Name: test.Name, Input: test.Input, Expected: test.Expected, Hidden: test.Hidden, Weight: test.Weight, TimeoutMS: test.TimeoutMS}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	a.ID = fmt.Sprint(r.ID)
	a.HasReferenceMaterial = strings.TrimSpace(a.ReferenceSolution) != "" || strings.TrimSpace(a.KnowledgeBase) != ""
	return a, e
}
func (s *MySQLStore) UpdateAssignment(id, teacherID uint, a domain.Assignment) (domain.Assignment, error) {
	rubric, err := json.Marshal(a.Rubric)
	if err != nil {
		return a, err
	}
	err = s.db.Transaction(func(tx *gorm.DB) error {
		var existing AssignmentRecord
		if err := tx.Where("id = ? AND teacher_id = ?", id, teacherID).First(&existing).Error; err != nil {
			return err
		}
		result := tx.Model(&AssignmentRecord{}).Where("id = ? AND teacher_id = ?", id, teacherID).Updates(map[string]any{
			"title": a.Title, "language": a.Language, "description": a.Description,
			"reference_solution": a.ReferenceSolution, "knowledge_base": a.KnowledgeBase,
			"status": a.Status, "max_submissions": a.MaxSubmissions, "due_at": a.DueAt,
			"rubric_json": rubric, "llm_evaluation_enabled": a.LLMEvaluationEnabled,
		})
		if result.Error != nil {
			return result.Error
		}
		if err := tx.Where("assignment_id = ?", id).Delete(&TestCaseRecord{}).Error; err != nil {
			return err
		}
		for _, test := range a.TestCases {
			row := TestCaseRecord{AssignmentID: id, Name: test.Name, Input: test.Input, Expected: test.Expected, Hidden: test.Hidden, Weight: test.Weight, TimeoutMS: test.TimeoutMS}
			if err := tx.Create(&row).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return a, err
	}
	return s.Assignment(id)
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
		var tests []TestCaseRecord
		if testErr := s.db.Where("assignment_id = ?", r.ID).Order("id asc").Find(&tests).Error; testErr != nil {
			return assignment, testErr
		}
		assignment.TestCases = make([]domain.TestCase, 0, len(tests))
		assignment.PublicTestCases = make([]domain.TestCase, 0)
		for _, test := range tests {
			item := domain.TestCase{Name: test.Name, Input: test.Input, Expected: test.Expected, Hidden: test.Hidden, Weight: test.Weight, TimeoutMS: test.TimeoutMS}
			assignment.TestCases = append(assignment.TestCases, item)
			if test.Hidden {
				assignment.HasHiddenTests = true
			} else {
				assignment.PublicTestCases = append(assignment.PublicTestCases, item)
			}
		}
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
func (s *MySQLStore) CreateSubmissionWithJob(studentID uint, sub domain.Submission) (domain.Submission, error) {
	err := s.db.Transaction(func(tx *gorm.DB) error {
		eval, err := json.Marshal(sub.Evaluation)
		if err != nil {
			return err
		}
		record := SubmissionRecord{AssignmentID: mustID(sub.AssignmentID), StudentID: studentID, Code: sub.Code, Status: sub.Status, Progress: sub.Progress, EvaluationJSON: eval, SubmittedAt: sub.SubmittedAt}
		if err := tx.Create(&record).Error; err != nil {
			return err
		}
		sub.ID = fmt.Sprint(record.ID)
		job := EvaluationJobRecord{SubmissionID: record.ID, AssignmentID: record.AssignmentID, StudentID: studentID, Status: "queued"}
		return tx.Create(&job).Error
	})
	return sub, err
}

func (s *MySQLStore) RequeueStaleJobs(staleBefore time.Time) error {
	return s.db.Model(&EvaluationJobRecord{}).
		Where("status = ? AND (locked_at IS NULL OR locked_at < ?)", "running", staleBefore).
		Updates(map[string]any{"status": "queued", "locked_by": "", "locked_at": nil}).Error
}

func (s *MySQLStore) FailExhaustedEvaluationJobs(maxAttempts int) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var jobs []EvaluationJobRecord
		if err := tx.Where("status = ? AND attempts >= ?", "queued", maxAttempts).Find(&jobs).Error; err != nil {
			return err
		}
		for _, job := range jobs {
			if err := tx.Model(&EvaluationJobRecord{}).Where("id = ?", job.ID).Updates(map[string]any{"status": "failed", "last_error": "maximum evaluation attempts reached"}).Error; err != nil {
				return err
			}
			if err := tx.Model(&SubmissionRecord{}).Where("id = ?", job.SubmissionID).Updates(map[string]any{"status": "failed", "progress": 100}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

// BackfillPendingEvaluationJobs upgrades submissions created by the former
// in-memory goroutine implementation without losing them during deployment.
func (s *MySQLStore) BackfillPendingEvaluationJobs() error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var submissions []SubmissionRecord
		if err := tx.Where("status IN ?", []string{"queued", "evaluating"}).Find(&submissions).Error; err != nil {
			return err
		}
		for _, submission := range submissions {
			job := EvaluationJobRecord{SubmissionID: submission.ID, AssignmentID: submission.AssignmentID, StudentID: submission.StudentID, Status: "queued"}
			result := tx.Where("submission_id = ?", submission.ID).FirstOrCreate(&job)
			if result.Error != nil {
				return result.Error
			}
			if result.RowsAffected == 0 {
				continue
			}
			if err := tx.Model(&SubmissionRecord{}).Where("id = ?", submission.ID).Updates(map[string]any{"status": "queued", "progress": 10}).Error; err != nil {
				return err
			}
		}
		return nil
	})
}

func (s *MySQLStore) ClaimEvaluationJob(workerID string, maxAttempts int) (EvaluationJob, error) {
	var claimed EvaluationJobRecord
	err := s.db.Transaction(func(tx *gorm.DB) error {
		result := tx.Clauses(clause.Locking{Strength: "UPDATE", Options: "SKIP LOCKED"}).
			Where("status = ? AND attempts < ?", "queued", maxAttempts).
			Order("created_at asc").Limit(1).Find(&claimed)
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 0 {
			// An empty queue is expected. Avoid First so GORM does not log a
			// misleading "record not found" query every poll.
			return nil
		}
		now := time.Now()
		return tx.Model(&EvaluationJobRecord{}).Where("id = ?", claimed.ID).Updates(map[string]any{
			"status": "running", "attempts": gorm.Expr("attempts + 1"), "locked_by": workerID, "locked_at": &now,
		}).Error
	})
	if err != nil {
		return EvaluationJob{}, err
	}
	if claimed.ID == 0 {
		return EvaluationJob{}, gorm.ErrRecordNotFound
	}
	claimed.Attempts++
	return EvaluationJob{ID: claimed.ID, SubmissionID: claimed.SubmissionID, AssignmentID: claimed.AssignmentID, StudentID: claimed.StudentID, Attempts: claimed.Attempts}, nil
}

func (s *MySQLStore) EvaluationJobPayload(job EvaluationJob) (domain.Assignment, domain.Submission, []domain.Submission, error) {
	assignment, err := s.Assignment(job.AssignmentID)
	if err != nil {
		return domain.Assignment{}, domain.Submission{}, nil, err
	}
	var record SubmissionRecord
	if err := s.db.First(&record, job.SubmissionID).Error; err != nil {
		return domain.Assignment{}, domain.Submission{}, nil, err
	}
	history, err := s.submissionHistoryExcluding(job.StudentID, job.AssignmentID, job.SubmissionID, 3)
	return assignment, submissionFrom(record, ""), history, err
}

func (s *MySQLStore) CompleteEvaluationJob(jobID, submissionID uint, evaluation domain.Evaluation) error {
	data, err := json.Marshal(evaluation)
	if err != nil {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&SubmissionRecord{}).Where("id = ?", submissionID).Updates(map[string]any{"status": evaluation.Status, "progress": 100, "evaluation_json": data}).Error; err != nil {
			return err
		}
		return tx.Model(&EvaluationJobRecord{}).Where("id = ?", jobID).Updates(map[string]any{"status": "completed", "locked_by": "", "locked_at": nil, "last_error": ""}).Error
	})
}

func (s *MySQLStore) FailEvaluationJob(job EvaluationJob, maxAttempts int, cause error) error {
	retry := job.Attempts < maxAttempts
	jobStatus, submissionStatus, progress := "failed", "failed", 100
	if retry {
		jobStatus, submissionStatus, progress = "queued", "queued", 10
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&SubmissionRecord{}).Where("id = ?", job.SubmissionID).Updates(map[string]any{"status": submissionStatus, "progress": progress}).Error; err != nil {
			return err
		}
		return tx.Model(&EvaluationJobRecord{}).Where("id = ?", job.ID).Updates(map[string]any{"status": jobStatus, "locked_by": "", "locked_at": nil, "last_error": cause.Error()}).Error
	})
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
	return s.submissionHistoryExcluding(studentID, assignmentID, 0, limit)
}
func (s *MySQLStore) submissionHistoryExcluding(studentID, assignmentID, excludedSubmissionID uint, limit int) ([]domain.Submission, error) {
	var rows []SubmissionRecord
	q := s.db.Where("student_id = ? AND assignment_id = ? AND evaluation_json IS NOT NULL", studentID, assignmentID).Order("submitted_at desc")
	if excludedSubmissionID != 0 {
		q = q.Where("id <> ?", excludedSubmissionID)
	}
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
