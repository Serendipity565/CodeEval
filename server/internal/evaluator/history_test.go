package evaluator

import (
	"encoding/json"
	"strings"
	"testing"

	"codeeval/server/internal/domain"
)

func TestHistoryUsesReviewedScoreAndOmitsIncompleteTotal(t *testing.T) {
	partial := &domain.Evaluation{Total: 30, Incomplete: true, Summary: "部分评分", Dimensions: []domain.DimensionScore{{Key: "quality", MaxScore: 100, Unscored: true}}}
	history := compactHistory([]domain.Submission{
		{Status: "graded", Evaluation: partial, Review: &domain.Review{Total: 87, Comment: "已根据代码复核", Dimensions: []domain.HumanScore{{Key: "quality", Score: 87, MaxScore: 100}}}},
		{Status: "needs_review", Evaluation: partial},
		{Status: "graded", Evaluation: &domain.Evaluation{Total: 0, Dimensions: []domain.DimensionScore{{Key: "quality", MaxScore: 100}}}},
	})
	if len(history) != 3 || history[0].Total == nil || *history[0].Total != 87 || !strings.Contains(history[0].Summary, "已根据代码复核") {
		t.Fatalf("teacher result missing from history: %+v", history)
	}
	if history[1].Total != nil || history[2].Total == nil || *history[2].Total != 0 {
		t.Fatalf("missing score confused with zero: %+v", history)
	}
	data, err := json.Marshal(history[1])
	if err != nil || strings.Contains(string(data), `"total"`) {
		t.Fatalf("partial total exposed to model: %s (%v)", data, err)
	}
	if partial.Total != 30 || partial.Summary != "部分评分" {
		t.Fatal("building history mutated original evaluation")
	}
}
