package store

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"codeeval/server/internal/domain"
	"gorm.io/gorm"
)

func TestAIDetectionReportsPersistFullResultAndUpsertBySubmission(t *testing.T) {
	rate := 62.0
	result := domain.AIDetection{SubmissionID: "7", Status: "estimated", AIRate: &rate, Confidence: 0.55, Summary: "结论", Evidence: []domain.AIEvidence{{StartLine: 1, EndLine: 1, Quote: "print(1)", Explanation: "依据"}}, Limitations: []string{"局限"}, Model: "model", ModelCalls: 1, GeneratedAt: time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)}
	result.Checks = []string{"复用本份提交已保存的沙箱结果", "参考比对已完成"}
	result.Execution = &domain.ExecutionEvidence{CompileOK: true, Passed: 1, Total: 2, Results: []domain.TestResult{{Name: "边界", Passed: false, Expected: "1", Actual: "0"}}}
	encoded, _ := json.Marshal(result)
	checkWrite := func(args []driver.NamedValue) {
		found := false
		for _, arg := range args {
			if value, ok := arg.Value.([]byte); ok {
				var saved domain.AIDetection
				if json.Unmarshal(value, &saved) == nil && saved.SubmissionID == "7" {
					found = true
					if !reflect.DeepEqual(saved, result) {
						t.Fatalf("incomplete saved result: %+v", saved)
					}
				}
			}
		}
		if !found {
			t.Fatal("result JSON not written")
		}
	}
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"},
		{kind: "exec", contains: []string{"INSERT INTO `ai_detection_records`", "ON DUPLICATE KEY UPDATE", "`result_json`=VALUES(`result_json`)", "`generated_at`=VALUES(`generated_at`)"}, check: checkWrite},
		{kind: "commit"},
		{kind: "query", contains: []string{"FROM `ai_detection_records`", "assignment_id = ? AND submission_id IN (?)"}, columns: []string{"submission_id", "assignment_id", "result_json", "generated_at"}, rows: [][]driver.Value{{int64(7), int64(2), encoded, result.GeneratedAt}}, check: func(args []driver.NamedValue) {
			if args[0].Value != int64(2) || args[1].Value != "7" {
				t.Fatalf("incorrect report scope: %v", args)
			}
		}},
	})
	if err := s.SaveAIDetection(context.Background(), 2, 7, result); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.AIDetectionResults(context.Background(), 2, []string{"7"})
	if err != nil || len(loaded) != 1 || !reflect.DeepEqual(loaded[0], result) {
		t.Fatalf("incorrect restored report: %+v %v", loaded, err)
	}
}

func TestAIDetectionEmptySelectionDoesNotReadOtherReports(t *testing.T) {
	s := assessmentTestStore(t, nil)
	loaded, err := s.AIDetectionResults(context.Background(), 2, nil)
	if err != nil || loaded == nil || len(loaded) != 0 {
		t.Fatalf("incorrect empty result: %+v %v", loaded, err)
	}
}

func TestSavedAIDetectionsEnforceOwnerAndSubmissionMembership(t *testing.T) {
	for _, own := range []bool{false, true} {
		t.Run(fmt.Sprint(own), func(t *testing.T) {
			owner := assessmentStep{kind: "query", contains: []string{"FROM `assignment_records`", "id = ? AND teacher_id = ?"}, columns: []string{"id"}}
			steps := []assessmentStep{owner}
			if own {
				steps[0].rows = [][]driver.Value{{int64(2)}}
				steps = append(steps, assessmentStep{kind: "query", contains: []string{"FROM `submission_records`", "id = ? AND assignment_id = ?"}, columns: []string{"id"}})
			}
			s := assessmentTestStore(t, steps)
			_, err := s.SavedAIDetections(context.Background(), 2, 9, 7)
			if !errors.Is(err, gorm.ErrRecordNotFound) {
				t.Fatalf("unauthorized cache access: %v", err)
			}
		})
	}
}

func TestSavedAIDetectionsOnlyReturnLatestSubmissionReports(t *testing.T) {
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "query", contains: []string{"id = ? AND teacher_id = ?"}, columns: []string{"id"}, rows: [][]driver.Value{{int64(2)}}},
		{kind: "query", contains: []string{"FROM `ai_detection_records`", "assignment_id = ? AND submission_id IN (SELECT `id` FROM `submission_records`", "NOT EXISTS", "newer.student_id = submission_records.student_id", "newer.id > submission_records.id"}, columns: []string{"submission_id"}},
	})
	results, err := s.SavedAIDetections(context.Background(), 2, 9, 0)
	if err != nil || results == nil || len(results) != 0 {
		t.Fatalf("unexpected reports: %+v %v", results, err)
	}
}

func TestAIDetectionContextScopesExecutionAndOnlyEarlierSameStudentVersions(t *testing.T) {
	at := time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)
	evaluation, _ := json.Marshal(domain.Evaluation{Execution: &domain.ExecutionEvidence{CompileOK: true, Passed: 1, Total: 2}})
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "query", contains: []string{"FROM `submission_records`", "id = ? AND assignment_id = ?"}, columns: []string{"id", "assignment_id", "student_id", "submitted_at", "evaluation_json"}, rows: [][]driver.Value{{int64(7), int64(2), int64(3), at, evaluation}}, check: func(args []driver.NamedValue) {
			if args[0].Value != int64(7) || args[1].Value != int64(2) {
				t.Fatalf("target not scoped: %v", args)
			}
		}},
		{kind: "query", contains: []string{"SELECT `id`,`code`,`submitted_at`", "assignment_id = ? AND student_id = ?", "submitted_at < ? OR (submitted_at = ? AND id < ?)", "ORDER BY submitted_at desc, id desc LIMIT ?"}, columns: []string{"id", "code", "submitted_at"}, rows: [][]driver.Value{{int64(6), "print(1)", at}}, check: func(args []driver.NamedValue) {
			if len(args) != 6 || args[0].Value != int64(2) || args[1].Value != int64(3) || args[2].Value != at || args[3].Value != at || args[4].Value != int64(7) || args[5].Value != int64(3) {
				t.Fatalf("history includes future, other student or unlimited attempts: %v", args)
			}
		}},
	})
	material, err := s.AIDetectionContext(context.Background(), 2, 7)
	if err != nil || material.Execution == nil || material.Execution.Passed != 1 || len(material.History) != 1 || material.History[0].ID != "6" || material.History[0].Code != "print(1)" {
		t.Fatalf("missing context: %+v %v", material, err)
	}
}

func TestAIDetectionContextRejectsMissingTargetAndCorruptEvaluation(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		step := assessmentStep{kind: "query", contains: []string{"id = ? AND assignment_id = ?"}, columns: []string{"id", "evaluation_json"}}
		if corrupt {
			step.rows = [][]driver.Value{{int64(7), []byte("invalid JSON")}}
		}
		s := assessmentTestStore(t, []assessmentStep{step})
		_, err := s.AIDetectionContext(context.Background(), 2, 7)
		if err == nil || !corrupt && !errors.Is(err, gorm.ErrRecordNotFound) {
			t.Fatalf("missing or broken context ignored: %v", err)
		}
	}
}
