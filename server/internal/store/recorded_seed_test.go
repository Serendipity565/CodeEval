package store

import (
	"encoding/json"
	"testing"
	"time"

	"codeeval/server/internal/domain"
)

// This minimal test fixture exercises validation only; it is never seeded.
func recordedSeedTestFixture() RecordedSeed {
	now := time.Now().UTC()
	rubric, _ := json.Marshal([]domain.RubricItem{{Key: "correctness", Name: "功能", Weight: 100}})
	evaluation, _ := json.Marshal(domain.Evaluation{Provider: "deepseek-agent", ModelCalls: 2, Status: "graded", DurationMS: 1200, Total: 100, MaxTotal: 100, Execution: &domain.ExecutionEvidence{Language: "C++", CompileOK: true, Total: 1, Passed: 1, TotalWeight: 1, PassedWeight: 1, Results: []domain.TestResult{{Name: "basic", Passed: true}}}, Dimensions: []domain.DimensionScore{{Key: "correctness", Name: "功能", Score: 100, MaxScore: 100, Evidence: "test execution"}}})
	return RecordedSeed{Version: 1, CapturedAt: now, Users: []RecordedSeedUser{{"teacher01", "教师", "teacher"}, {"student01", "学生", "student"}}, Assignment: RecordedSeedAssignment{Teacher: "teacher01", Language: "C++", LLMEvaluationEnabled: true, Rubric: rubric, Tests: []domain.TestCase{{Name: "basic", Weight: 1}}}, Submissions: []RecordedSeedSubmission{{Student: "student01", Code: "int main() {}", SubmittedAt: now, Evaluation: evaluation}}}
}
func TestRecordedSeedRequiresCompleteActualEvidence(t *testing.T) {
	valid := recordedSeedTestFixture()
	if err := ValidateRecordedSeed(valid); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name   string
		change func(*domain.Evaluation)
	}{
		{"synthetic provider", func(e *domain.Evaluation) { e.Provider = "rules" }},
		{"no model call", func(e *domain.Evaluation) { e.ModelCalls = 0 }},
		{"missing sandbox", func(e *domain.Evaluation) { e.Execution = nil }},
		{"partial tests", func(e *domain.Evaluation) { e.Execution.Total = 0 }},
		{"unscored dimension", func(e *domain.Evaluation) { e.Dimensions[0].Unscored = true }},
		{"incorrect total", func(e *domain.Evaluation) { e.Total = 70 }},
		{"failed", func(e *domain.Evaluation) { e.Status = "failed" }},
	} {
		t.Run(test.name, func(t *testing.T) {
			fixture := recordedSeedTestFixture()
			var e domain.Evaluation
			if err := json.Unmarshal(fixture.Submissions[0].Evaluation, &e); err != nil {
				t.Fatal(err)
			}
			test.change(&e)
			fixture.Submissions[0].Evaluation, _ = json.Marshal(e)
			if err := ValidateRecordedSeed(fixture); err == nil {
				t.Fatal("invalid capture accepted")
			}
		})
	}
}
func TestRecordedSeedRejectsMissingOrDuplicateStudents(t *testing.T) {
	fixture := recordedSeedTestFixture()
	fixture.Users = append(fixture.Users, RecordedSeedUser{"student02", "学生二", "student"})
	if err := ValidateRecordedSeed(fixture); err == nil {
		t.Fatal("missing student accepted")
	}
	fixture = recordedSeedTestFixture()
	fixture.Submissions = append(fixture.Submissions, fixture.Submissions[0])
	if err := ValidateRecordedSeed(fixture); err == nil {
		t.Fatal("duplicate student accepted")
	}
}
