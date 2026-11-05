package evaluator

import (
	"encoding/json"
	"testing"
	"time"

	"codeeval/server/internal/domain"
)

func TestRecalculateSavedPercentagesIncludesOriginalWeakAndOverlappingValuesWithoutMutation(t *testing.T) {
	d := aiDimensionFixture(t)
	first, second, third := 62, 55, 40
	d[0].Score, d[1].Score = &first, &second
	d[0].Included, d[1].Included = true, true
	e := domain.AIEvidence{StartLine: 7, EndLine: 8, Quote: "vector<int> values(n);\nread(values);", Explanation: "verified input snippet"}
	d[1].Evidence = []domain.AIEvidence{e}
	d[3] = domain.AIDimension{Key: "sample_match", Status: "assessed", Score: &third, Strength: "weak", Reason: "sample comparison", Alternative: "common input pattern", Evidence: []domain.AIEvidence{e, e}, Included: false, ExclusionReason: "duplicate"}
	oldRate := 58.5
	old := domain.AIDetection{ScoringVersion: "dimensions-v5", Status: "estimated", AIRate: &oldRate, Dimensions: d, GeneratedAt: time.Date(2026, 11, 5, 6, 0, 0, 0, time.UTC), ModelCalls: 2, SubmissionID: "7", Checks: []string{"original verification"}, Summary: "较高生成倾向，由各维度证据按固定规则综合得出。 原分析事实。"}
	before, _ := json.Marshal(old)
	result := RecalculateAIScoring(old)
	if result.AIRate == nil || *result.AIRate != 52.3 || result.Coverage != .6 || !result.Dimensions[3].Included || *result.Dimensions[3].EffectiveScore != 40 || result.Dimensions[3].ExclusionReason != "" {
		t.Fatalf("saved sample value was not included once: %+v", result)
	}
	if result.ScoringVersion != "dimensions-v6" || result.RecalculatedFromVersion != "dimensions-v5" || !result.GeneratedAt.Equal(old.GeneratedAt) || result.ModelCalls != old.ModelCalls || result.SubmissionID != "7" || len(result.Checks) != 1 {
		t.Fatal("projection lost original analysis metadata")
	}
	if result.Summary != "较高生成倾向，由各维度证据按固定规则综合得出。 原分析事实。" {
		t.Fatal("factual summary lost or previous classification prefix retained")
	}
	after, _ := json.Marshal(old)
	if string(before) != string(after) {
		t.Fatal("recalculation mutated the saved report")
	}
	idempotent, _ := json.Marshal(RecalculateAIScoring(result))
	once, _ := json.Marshal(result)
	if string(idempotent) != string(once) {
		t.Fatal("projection was applied twice")
	}
}

func TestRecalculateKeepsHistoricalScalesAndInvalidReports(t *testing.T) {
	for _, version := range []string{"", "dimensions-v1", "dimensions-v4", "dimensions-v7"} {
		previous := domain.AIDetection{ScoringVersion: version, Dimensions: aiDimensionFixture(t)}
		before, _ := json.Marshal(previous)
		after, _ := json.Marshal(RecalculateAIScoring(previous))
		if string(before) != string(after) {
			t.Fatalf("historical scale changed: %s", version)
		}
	}
	previous := domain.AIDetection{ScoringVersion: "dimensions-v5", Dimensions: aiDimensionFixture(t)}
	previous.Dimensions[0].Score = new(int)
	*previous.Dimensions[0].Score = 101
	if result := RecalculateAIScoring(previous); result.ScoringVersion != "dimensions-v5" {
		t.Fatal("invalid saved scores silently recalculated")
	}
}
