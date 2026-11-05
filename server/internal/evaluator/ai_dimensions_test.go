package evaluator

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"codeeval/server/internal/domain"
)

func aiDimensionFixture(t *testing.T) []domain.AIDimension {
	t.Helper()
	var output struct {
		Dimensions []domain.AIDimension `json:"dimensions"`
	}
	if err := json.Unmarshal([]byte(validAIResult), &output); err != nil {
		t.Fatal(err)
	}
	return output.Dimensions
}

func TestAIDimensionWeightsMissingMaterialAndServerOwnedFields(t *testing.T) {
	dimensions := aiDimensionFixture(t)
	dimensions[0].Weight, dimensions[0].Label = 999, "伪造权重"
	dimensions[0].EffectiveScore = new(int)
	dimensions[0].Evidence[0].Counted = false
	result := aggregateAIDimensions(dimensions, "")
	if result.AIRate == nil || *result.AIRate != 3 || result.Coverage != .4 || result.Dimensions[0].Weight != 20 || result.Dimensions[0].Label == "伪造权重" {
		t.Fatalf("wrong aggregation or missing dimension treated as zero: %+v", result)
	}
	if result.Dimensions[2].Included || result.Dimensions[2].EffectiveScore != nil || result.Dimensions[2].Score != nil {
		t.Fatal("unknown comments became zero or participated in the score")
	}
	if result.ScoringVersion != aiScoringVersion || result.Confidence != 0 || dimensions[0].Evidence[0].Counted {
		t.Fatal("legacy confidence manufactured or model input mutated")
	}
}

func TestAIDimensionScoresRemainIncludedWithSharedSourceOrFramework(t *testing.T) {
	for _, kind := range []string{"same quote", "overlap", "framework", "identical quote elsewhere"} {
		t.Run(kind, func(t *testing.T) {
			d := aiDimensionFixture(t)
			starter := ""
			switch kind {
			case "same quote":
				d[1].Evidence = append([]domain.AIEvidence{}, d[0].Evidence...)
			case "identical quote elsewhere":
				d[1].Evidence[0].Quote = d[0].Evidence[0].Quote
			case "overlap":
				d[1].Evidence[0].StartLine = 1
			case "framework":
				starter = "def main():\n    value = 1\n    pass"
			}
			result := aggregateAIDimensions(d, starter)
			if result.AIRate == nil || *result.AIRate != 3 || result.Coverage != .4 || result.Status != "estimated" || len(result.Evidence) != 2 {
				t.Fatalf("shared references excluded an assessed dimension: %+v", result)
			}
			for _, dimension := range result.Dimensions[:2] {
				if !dimension.Included || dimension.EffectiveScore == nil || *dimension.EffectiveScore != 3 {
					t.Fatal("dimension score was dropped")
				}
				for _, evidence := range dimension.Evidence {
					if !evidence.Counted {
						t.Fatal("valid evidence was excluded for overlap")
					}
				}
			}
		})
	}
}

func TestAIDimensionEqualStrengthPreservesScoresAndAvailability(t *testing.T) {
	for _, strength := range []string{"weak", "moderate", "strong"} {
		for score := 0; score <= 100; score++ {
			t.Run(fmt.Sprintf("%s-score-%d", strength, score), func(t *testing.T) {
				d := aiDimensionFixture(t)
				for i := 0; i < 2; i++ {
					d[i].Score = &score
					d[i].Strength = strength
				}
				if err := validateAIDimensions(d, []string{"value = 1", "print(value)"}); err != nil {
					t.Fatal(err)
				}
				result := aggregateAIDimensions(d, "")
				if result.Status != "estimated" || result.AIRate == nil || *result.AIRate != float64(score) || result.Coverage != .4 {
					t.Fatalf("strength altered the total or prevented a low score: %+v", result)
				}
				for i := 0; i < 2; i++ {
					if *result.Dimensions[i].EffectiveScore != score {
						t.Fatal("strength changed dimension score")
					}
				}
			})
		}
	}
}

func TestAIDimensionSixtyPercentCoverageWithWeakEvidenceProducesTotal(t *testing.T) {
	d := aiDimensionFixture(t)
	d[0].Strength, d[1].Strength = "weak", "weak"
	score := 0
	d[2] = domain.AIDimension{Key: "comments", Status: "assessed", Score: &score, Strength: "weak", Evidence: []domain.AIEvidence{{StartLine: 3, EndLine: 3, Quote: "# explanation"}}}
	result := aggregateAIDimensions(d, "")
	if result.Coverage != .6 || result.Status != "estimated" || result.AIRate == nil || *result.AIRate != 2 {
		t.Fatalf("60 percent coverage incorrectly rejected or score capped: %+v", result)
	}
}

func TestAIPercentageMixedScoresNormalizeOverAvailableDimensions(t *testing.T) {
	d := aiDimensionFixture(t)
	first, second, third := 41, 44, 45
	d[0].Score, d[1].Score = &first, &second
	d[2] = domain.AIDimension{Key: "comments", Status: "assessed", Score: &third, Strength: "weak", Evidence: []domain.AIEvidence{{StartLine: 3, EndLine: 3, Quote: "# explanation"}}}
	result := aggregateAIDimensions(d, "")
	if result.ScoringVersion != aiScoringVersion || result.Coverage != .6 || result.AIRate == nil || *result.AIRate != 42.9 {
		t.Fatalf("percentage scale used the wrong denominator or counted missing dimensions as zero: %+v", result)
	}
	first++
	changed := aggregateAIDimensions(d, "")
	if changed.AIRate == nil || *changed.AIRate != 43.3 {
		t.Fatalf("one percentage point difference was lost: %+v", changed)
	}
}

func TestAIDimensionSharedEvidenceDoesNotChangeScoresWithStrengthOrOrder(t *testing.T) {
	for _, strengths := range [][2]string{{"weak", "strong"}, {"strong", "weak"}} {
		d := aiDimensionFixture(t)
		d[0].Strength, d[1].Strength = strengths[0], strengths[1]
		d[1].Evidence = append([]domain.AIEvidence{}, d[0].Evidence...)
		d[0], d[2] = d[2], d[0]
		result := aggregateAIDimensions(d, "")
		if result.Dimensions[0].Key != "task_fit" || !result.Dimensions[0].Included || !result.Dimensions[1].Included || result.AIRate == nil || *result.AIRate != 3 {
			t.Fatalf("strength or order dropped a shared-reference score: %+v", result)
		}
	}
}

func TestAISingleAvailableDimensionContributesAndUnknownDoesNotBecomeZero(t *testing.T) {
	d := aiDimensionFixture(t)
	d[0].Status, d[0].Score, d[0].Strength, d[0].Evidence = "insufficient_evidence", nil, "none", []domain.AIEvidence{}
	result := aggregateAIDimensions(d, "")
	if result.AIRate == nil || *result.AIRate != 3 || result.Coverage != .2 || !result.Dimensions[1].Included {
		t.Fatalf("available value excluded or unknown counted as zero: %+v", result)
	}
	d[1].Status, d[1].Score, d[1].Strength, d[1].Evidence = "insufficient_evidence", nil, "none", []domain.AIEvidence{}
	result = aggregateAIDimensions(d, "")
	if result.AIRate != nil || result.Status != "insufficient_evidence" || result.Coverage != 0 {
		t.Fatal("missing values manufactured a total")
	}
}

func TestAIDimensionTotalAndConfidenceCannotBeSetByModel(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(_ *http.Request) (*http.Response, error) {
		return jsonResponse(strings.Replace(validAIResult, `{"summary":`, `{"aiRate":99,"confidence":1,"status":"estimated","summary":`, 1)), nil
	})
	result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	if err != nil || result.AIRate == nil || *result.AIRate != 3 || result.Confidence != 0 {
		t.Fatalf("model supplied total overrode server calculation: %+v %v", result, err)
	}
}
