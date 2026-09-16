package evaluator

import (
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
