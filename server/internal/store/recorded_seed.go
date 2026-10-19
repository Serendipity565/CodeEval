package store

import (
	"encoding/json"
	"fmt"
	"time"

	"codeeval/server/internal/domain"
	"gorm.io/gorm"
)

// RecordedSeed contains actual application results, without credentials or jobs.
// Importing it must never call an evaluator or invent replacement scores.
type RecordedSeed struct {
	Version     int                      `json:"version"`
	CapturedAt  time.Time                `json:"capturedAt"`
	Source      string                   `json:"source"`
	Users       []RecordedSeedUser       `json:"users"`
	Assignment  RecordedSeedAssignment   `json:"assignment"`
	Submissions []RecordedSeedSubmission `json:"submissions"`
}
type RecordedSeedUser struct {
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Role        string `json:"role"`
}
type RecordedSeedAssignment struct {
	SourceID             uint              `json:"sourceId"`
	Teacher              string            `json:"teacher"`
	Title                string            `json:"title"`
	Language             string            `json:"language"`
	Description          string            `json:"description"`
	ReferenceSolution    string            `json:"referenceSolution"`
	KnowledgeBase        string            `json:"knowledgeBase"`
	Status               string            `json:"status"`
	MaxSubmissions       int               `json:"maxSubmissions"`
	DueAt                time.Time         `json:"dueAt"`
	CreatedAt            time.Time         `json:"createdAt"`
	Rubric               json.RawMessage   `json:"rubric"`
	Tests                []domain.TestCase `json:"tests"`
	LLMEvaluationEnabled bool              `json:"llmEvaluationEnabled"`
}
type RecordedSeedSubmission struct {
	SourceID    uint            `json:"sourceId"`
	Student     string          `json:"student"`
	Code        string          `json:"code"`
	SubmittedAt time.Time       `json:"submittedAt"`
	Evaluation  json.RawMessage `json:"evaluation"`
}

// ExportRecordedSeed reads only the specified demo cohort. Its transaction makes
// the assignment, tests and submissions a consistent snapshot. Failed attempts
// remain in the source database and are deliberately excluded from the fixture.
func ExportRecordedSeed(db *gorm.DB, assignmentID uint, usernames []string) (RecordedSeed, error) {
	snapshot := RecordedSeed{Version: 1, CapturedAt: time.Now().UTC(), Source: "CodeEval browser submissions + sandbox execution + model evaluation"}
	err := db.Transaction(func(tx *gorm.DB) error {
		var a AssignmentRecord
		if err := tx.First(&a, assignmentID).Error; err != nil {
			return err
		}
		var teacher User
		if err := tx.Select("id", "username", "display_name", "role").First(&teacher, a.TeacherID).Error; err != nil {
			return err
		}
		snapshot.Users = append(snapshot.Users, RecordedSeedUser{teacher.Username, teacher.DisplayName, teacher.Role})
		snapshot.Assignment = RecordedSeedAssignment{SourceID: a.ID, Teacher: teacher.Username, Title: a.Title, Language: a.Language, Description: a.Description, ReferenceSolution: a.ReferenceSolution, KnowledgeBase: a.KnowledgeBase, Status: a.Status, MaxSubmissions: a.MaxSubmissions, DueAt: a.DueAt, CreatedAt: a.CreatedAt, Rubric: json.RawMessage(a.RubricJSON), LLMEvaluationEnabled: a.LLMEvaluationEnabled}
		var tests []TestCaseRecord
		if err := tx.Where("assignment_id = ?", a.ID).Order("id").Find(&tests).Error; err != nil {
			return err
		}
		for _, test := range tests {
			snapshot.Assignment.Tests = append(snapshot.Assignment.Tests, domain.TestCase{Name: test.Name, Input: test.Input, Expected: test.Expected, Hidden: test.Hidden, Weight: test.Weight, TimeoutMS: test.TimeoutMS})
		}
		for _, username := range usernames {
			var user User
			if err := tx.Select("id", "username", "display_name", "role").Where("username = ?", username).First(&user).Error; err != nil {
				return err
			}
			if user.Role != "student" {
				return fmt.Errorf("%s is not a student", username)
			}
			snapshot.Users = append(snapshot.Users, RecordedSeedUser{user.Username, user.DisplayName, user.Role})
			var sub SubmissionRecord
			if err := tx.Where("assignment_id = ? AND student_id = ? AND status = ?", a.ID, user.ID, "graded").Order("submitted_at desc, id desc").First(&sub).Error; err != nil {
				return fmt.Errorf("%s has no completed grade: %w", username, err)
			}
			snapshot.Submissions = append(snapshot.Submissions, RecordedSeedSubmission{SourceID: sub.ID, Student: username, Code: sub.Code, SubmittedAt: sub.SubmittedAt, Evaluation: json.RawMessage(sub.EvaluationJSON)})
		}
		return ValidateRecordedSeed(snapshot)
	})
	return snapshot, err
}

func ValidateRecordedSeed(snapshot RecordedSeed) error {
	if snapshot.Version != 1 || snapshot.CapturedAt.IsZero() || len(snapshot.Submissions) == 0 || snapshot.Assignment.Language != "C++" || !snapshot.Assignment.LLMEvaluationEnabled || len(snapshot.Assignment.Tests) == 0 {
		return fmt.Errorf("incomplete recorded seed metadata")
	}
	users := map[string]string{}
	for _, user := range snapshot.Users {
		if user.Username == "" || users[user.Username] != "" {
			return fmt.Errorf("duplicate or empty user")
		}
		users[user.Username] = user.Role
	}
	if users[snapshot.Assignment.Teacher] != "teacher" {
		return fmt.Errorf("missing teacher")
	}
	var rubric []domain.RubricItem
	if err := json.Unmarshal(snapshot.Assignment.Rubric, &rubric); err != nil {
		return err
	}
	rubricTotal := 0
	for _, d := range rubric {
		rubricTotal += d.Weight
	}
	if rubricTotal != 100 {
		return fmt.Errorf("invalid rubric total")
	}
	seen := map[string]bool{}
	for _, sub := range snapshot.Submissions {
		if users[sub.Student] != "student" || seen[sub.Student] || sub.Code == "" || sub.SubmittedAt.IsZero() {
			return fmt.Errorf("invalid submission for %s", sub.Student)
		}
		seen[sub.Student] = true
		var e domain.Evaluation
		if err := json.Unmarshal(sub.Evaluation, &e); err != nil {
			return err
		}
		if e.Provider != "deepseek-agent" || e.ModelCalls < 1 || e.Incomplete || e.Status != "graded" || e.DurationMS <= 0 || e.Execution == nil || e.Execution.Language != "C++" || e.Execution.Total != len(snapshot.Assignment.Tests) || len(e.Execution.Results) != len(snapshot.Assignment.Tests) || len(e.Dimensions) != len(rubric) {
			return fmt.Errorf("%s lacks complete actual evaluation evidence (provider=%s calls=%d status=%s incomplete=%t duration=%d dimensions=%d executionPresent=%t)", sub.Student, e.Provider, e.ModelCalls, e.Status, e.Incomplete, e.DurationMS, len(e.Dimensions), e.Execution != nil)
		}
		total := 0
		for i, d := range e.Dimensions {
			if d.Unscored || d.Key != rubric[i].Key || d.MaxScore != rubric[i].Weight || d.Score < 0 || d.Score > d.MaxScore || d.Evidence == "" {
				return fmt.Errorf("invalid dimension for %s", sub.Student)
			}
			total += d.Score
		}
		if total != e.Total || e.MaxTotal != 100 {
			return fmt.Errorf("incorrect score total for %s", sub.Student)
		}
	}
	if len(seen) != len(users)-1 {
		return fmt.Errorf("some students have no complete result")
	}
	return nil
}

// SeedRecordedData replays a validated capture without reevaluating it. Existing
// accounts, submissions and teacher reviews are never replaced by the snapshot.
func SeedRecordedData(s *MySQLStore, snapshot RecordedSeed) error {
	if err := ValidateRecordedSeed(snapshot); err != nil {
		return err
	}
	return s.db.Transaction(func(tx *gorm.DB) error {
		users := make(map[string]User, len(snapshot.Users))
		for _, item := range snapshot.Users {
			user, err := ensureMockUser(tx, item.Username, item.DisplayName, item.Role)
			if err != nil {
				return err
			}
			if user.Role != item.Role {
				return fmt.Errorf("existing account %s has a different role", item.Username)
			}
			users[item.Username] = user
		}
		source := snapshot.Assignment
		assignment := AssignmentRecord{TeacherID: users[source.Teacher].ID, Title: source.Title, Language: source.Language, Description: source.Description, ReferenceSolution: source.ReferenceSolution, KnowledgeBase: source.KnowledgeBase, Status: source.Status, MaxSubmissions: source.MaxSubmissions, DueAt: source.DueAt, CreatedAt: source.CreatedAt, RubricJSON: []byte(source.Rubric), LLMEvaluationEnabled: source.LLMEvaluationEnabled}
		if err := tx.Where("teacher_id = ? AND title = ? AND language = ?", assignment.TeacherID, assignment.Title, assignment.Language).FirstOrCreate(&assignment).Error; err != nil {
			return err
		}
		for _, item := range source.Tests {
			test := TestCaseRecord{AssignmentID: assignment.ID, Name: item.Name, Input: item.Input, Expected: item.Expected, Hidden: item.Hidden, Weight: item.Weight, TimeoutMS: item.TimeoutMS}
			if err := tx.Where("assignment_id = ? AND name = ?", assignment.ID, test.Name).FirstOrCreate(&test).Error; err != nil {
				return err
			}
		}
		for _, item := range snapshot.Submissions {
			submission := SubmissionRecord{AssignmentID: assignment.ID, StudentID: users[item.Student].ID, Code: item.Code, Status: "graded", Progress: 100, EvaluationJSON: []byte(item.Evaluation), SubmittedAt: item.SubmittedAt}
			if err := tx.Where("assignment_id = ? AND student_id = ?", assignment.ID, submission.StudentID).FirstOrCreate(&submission).Error; err != nil {
				return err
			}
		}
		return nil
	})
}
