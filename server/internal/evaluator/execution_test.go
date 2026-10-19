package evaluator

import (
	"strings"
	"testing"

	"codeeval/server/internal/domain"
)

func TestExecutionEvidenceOverridesFunctionalityScore(t *testing.T) {
	assignment := domain.Assignment{Rubric: []domain.RubricItem{{Key: "correctness", Name: "功能正确性", Weight: 60}, {Key: "quality", Name: "代码质量", Weight: 40}}}
	result := domain.Evaluation{Dimensions: []domain.DimensionScore{{Key: "correctness", Score: 55, Confidence: .5}, {Key: "quality", Score: 30, Confidence: .6}}}
	execution := &domain.ExecutionEvidence{CompileOK: true, Passed: 1, Total: 2, PassedWeight: 3, TotalWeight: 4}
	applyExecutionEvidence(&result, assignment, execution)
	if result.Dimensions[0].Score != 45 || !result.Dimensions[0].Verified || result.Dimensions[0].EvidenceType != "execution" {
		t.Fatalf("execution did not override functionality: %+v", result.Dimensions[0])
	}
	if result.Total != 75 || result.Dimensions[1].Score != 30 {
		t.Fatalf("unexpected recomputed scores: %+v", result)
	}
}

func TestRuleEvaluationKeepsUnsupportedDimensionsUnscored(t *testing.T) {
	assignment := domain.Assignment{Rubric: []domain.RubricItem{{Key: "correctness", Name: "功能正确性", Weight: 60}, {Key: "quality", Name: "代码质量", Weight: 40}}}
	result := Evaluate("func main() {}", assignment.Rubric)
	if result.Total != 0 || !result.Incomplete || !result.Dimensions[0].Unscored {
		t.Fatalf("local scan manufactured grades: %+v", result)
	}
	applyExecutionEvidence(&result, assignment, &domain.ExecutionEvidence{CompileOK: true, Passed: 1, Total: 2, PassedWeight: 1, TotalWeight: 2})
	if result.Total != 30 || result.Dimensions[0].Unscored || !result.Dimensions[1].Unscored || !result.Incomplete {
		t.Fatalf("partial evidence mishandled: %+v", result)
	}
	if strings.Contains(result.Summary, "未编译") || result.Verified || result.Status != "needs_review" {
		t.Fatalf("feedback contradicts execution: %+v", result)
	}
}

func TestRuleCompileFailureIsEvidenceNotInfrastructureFailure(t *testing.T) {
	assignment := domain.Assignment{Rubric: []domain.RubricItem{{Key: "correctness", Name: "功能正确性", Weight: 100}}}
	result := Evaluate("bad program", assignment.Rubric)
	applyExecutionEvidence(&result, assignment, &domain.ExecutionEvidence{CompileOK: false, CompileError: "syntax error", Total: 1, TotalWeight: 1})
	if result.Total != 0 || result.Incomplete || result.Status != "graded" || !strings.Contains(result.Summary, "编译失败") {
		t.Fatalf("compile failure was not scored correctly: %+v", result)
	}
}
