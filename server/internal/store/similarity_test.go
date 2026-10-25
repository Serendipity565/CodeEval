package store

import (
	"context"
	"database/sql/driver"
	"errors"
	"gorm.io/gorm"
	"testing"
	"time"
)

func TestSimilarityOwnershipIsCheckedBeforeSourceRead(t *testing.T) {
	store := assessmentTestStore(t, []assessmentStep{{kind: "query", contains: []string{"FROM `assignment_records`", "id = ? AND teacher_id = ?"}, columns: []string{"id"}, check: func(args []driver.NamedValue) {
		if args[0].Value != int64(2) || args[1].Value != int64(99) {
			t.Fatalf("missing owner scope: %v", args)
		}
	}}})
	_, err := store.SimilaritySubmissions(context.Background(), 2, 99, nil)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("unauthorized read: %v", err)
	}
}
func TestSimilaritySelectsLatestOrExplicitSubmissions(t *testing.T) {
	for _, selection := range []string{"latest", "pair", "single_ai_detection"} {
		t.Run(selection, func(t *testing.T) {
			contains := []string{"FROM `submission_records`", "assignment_id = ?", "LIMIT ?"}
			var ids []string
			if selection == "latest" {
				contains = append(contains, "NOT EXISTS", "newer.student_id = submission_records.student_id", "newer.submitted_at > submission_records.submitted_at", "newer.id > submission_records.id")
			} else if selection == "pair" {
				contains = append(contains, "id IN (?,?)")
				ids = []string{"7", "8"}
			} else {
				contains = append(contains, "id IN (?)")
				ids = []string{"7"}
			}
			store := assessmentTestStore(t, []assessmentStep{
				{kind: "query", contains: []string{"id = ? AND teacher_id = ?"}, columns: []string{"id"}, rows: [][]driver.Value{{int64(2)}}},
				{kind: "query", contains: contains, columns: []string{"id", "assignment_id", "student_id", "code", "submitted_at"}, rows: [][]driver.Value{{int64(7), int64(2), int64(3), "print(1)", time.Now()}}},
				{kind: "query", contains: []string{"FROM `users`"}, columns: []string{"id", "display_name"}, rows: [][]driver.Value{{int64(3), "学生"}}},
			})
			sources, err := store.SimilaritySubmissions(context.Background(), 2, 9, ids)
			if err != nil || len(sources) != 1 || sources[0].Code != "print(1)" || sources[0].StudentName != "学生" {
				t.Fatalf("wrong sources: %+v %v", sources, err)
			}
		})
	}
}
