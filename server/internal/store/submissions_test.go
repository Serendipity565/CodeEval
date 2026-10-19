package store

import (
	"database/sql/driver"
	"errors"
	"testing"
	"time"

	"codeeval/server/internal/domain"
	"gorm.io/gorm"
)

func deadlineLockStep(due time.Time) assessmentStep {
	return assessmentStep{
		kind: "query", contains: []string{"FROM `assignment_records`", "FOR UPDATE"},
		columns: []string{"id", "due_at"}, rows: [][]driver.Value{{int64(2), due}},
	}
}

func TestSubmissionDeadlineRejectsWithoutCreatingSubmissionOrJob(t *testing.T) {
	for _, test := range []struct {
		name string
		due  time.Time
	}{
		{"expired open assignment", time.Now().Add(-time.Hour)},
		{"missing deadline", time.Time{}},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := assessmentTestStore(t, []assessmentStep{
				{kind: "begin"}, deadlineLockStep(test.due), {kind: "rollback"},
			})
			// An old request timestamp must not bypass the current deadline check.
			_, err := store.CreateSubmissionWithJob(3, domain.Submission{
				AssignmentID: "2", Code: "print(1)", Status: "queued",
				SubmittedAt: time.Now().Add(-24 * time.Hour),
			})
			if !errors.Is(err, ErrSubmissionDeadlinePassed) {
				t.Fatalf("expired submission returned %v", err)
			}
		})
	}
}

func TestSubmissionBeforeDeadlineCreatesSubmissionAndJob(t *testing.T) {
	start := time.Now()
	var storedAt time.Time
	store := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"}, deadlineLockStep(start.Add(time.Hour)),
		{kind: "exec", contains: []string{"INSERT INTO `submission_records`"}, insertID: 7,
			check: func(args []driver.NamedValue) {
				for _, arg := range args {
					if timestamp, ok := arg.Value.(time.Time); ok {
						storedAt = timestamp
					}
				}
			}},
		{kind: "exec", contains: []string{"INSERT INTO `evaluation_job_records`"}, insertID: 8},
		{kind: "commit"},
	})
	sub, err := store.CreateSubmissionWithJob(3, domain.Submission{
		AssignmentID: "2", Code: "print(1)", Status: "queued", SubmittedAt: start.Add(-time.Hour),
	})
	if err != nil {
		t.Fatal(err)
	}
	if sub.ID != "7" || sub.StudentID != "3" || sub.SubmittedAt.Before(start) || !sub.SubmittedAt.Equal(storedAt) {
		t.Fatalf("incorrect accepted submission: %+v, storedAt=%v", sub, storedAt)
	}
}

func TestSubmissionMissingAssignmentDoesNotCreateWork(t *testing.T) {
	step := deadlineLockStep(time.Time{})
	step.rows = nil
	store := assessmentTestStore(t, []assessmentStep{{kind: "begin"}, step, {kind: "rollback"}})
	_, err := store.CreateSubmissionWithJob(3, domain.Submission{AssignmentID: "2"})
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing assignment returned %v", err)
	}
}
