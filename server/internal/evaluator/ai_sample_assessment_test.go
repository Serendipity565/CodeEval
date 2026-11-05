package evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"testing"

	"codeeval/server/internal/domain"
)

func completedSampleComparison(values ...float64) *domain.AISampleComparison {
	out := &domain.AISampleComparison{Status: "compared"}
	for i, value := range values {
		out.Samples = append(out.Samples, domain.AISampleMatch{ID: []string{"ai-sample-1", "ai-sample-2", "ai-sample-3"}[i], Pair: domain.SimilarityPair{Similarity: value}})
	}
	return out
}

func aiSampleAssessmentResult(score int) string {
	var output map[string]any
	if err := json.Unmarshal([]byte(validAIResult), &output); err != nil {
		panic(err)
	}
	output["dimensions"].([]any)[3] = domain.AIDimension{Key: "sample_match", Status: "assessed", Score: &score, Strength: "weak", Reason: "Compared all three implementations; no token runs matched, but structural choices still permit a weak assessment.", Alternative: "Common task requirements also explain these choices; zero matching tokens do not prove human origin.", Evidence: []domain.AIEvidence{}}
	return mustJSON(output)
}

func zeroMatchSampleBank() *domain.AISampleBank {
	return &domain.AISampleBank{Samples: []domain.AISample{{ID: "ai-sample-1", Code: "print(2)"}, {ID: "ai-sample-2", Code: "print(3)"}, {ID: "ai-sample-3", Code: "print(4)"}}}
}

func TestZeroTokenMatchesKeepIndependentLLMScoreAndAllSampleSources(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 2048)
	calls := 0
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		var request chatRequest
		if err := json.NewDecoder(req.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		var payload struct {
			Verification aiVerification `json:"verification"`
		}
		if err := json.Unmarshal([]byte(request.Messages[1].Content), &payload); err != nil {
			t.Fatal(err)
		}
		v := payload.Verification
		if len(v.SampleSources) != 3 || len(v.SampleEvidence) != 0 || !completeAISampleComparison(v.SampleComparison) {
			t.Fatalf("zero-match analysis lacks its actual sources/statistics: %+v", v)
		}
		for i, sample := range v.SampleSources {
			if sample.ID != zeroMatchSampleBank().Samples[i].ID || len(sample.Source) != 1 || sample.Source[0].Line != 1 || sample.Source[0].Code != zeroMatchSampleBank().Samples[i].Code || v.SampleComparison.Samples[i].Pair.MatchedTokens != 0 {
				t.Fatalf("wrong or omitted source for zero-match sample: %+v", sample)
			}
		}
		score := []int{37, 61}[calls]
		calls++
		return jsonResponse(aiSampleAssessmentResult(score)), nil
	})
	for _, want := range []int{37, 61} {
		result, err := client.DetectAICode(context.Background(), domain.Assignment{Language: "Python"}, "value = 1\nprint(value)", domain.AIDetectionContext{SampleBank: zeroMatchSampleBank()})
		if err != nil {
			t.Fatal(err)
		}
		d := result.Dimensions[3]
		if d.Score == nil || *d.Score != want || d.EffectiveScore == nil || *d.EffectiveScore != want || !d.Included || d.Strength != "weak" || d.EvidenceBasis != "sample_comparison" || len(d.Evidence) != 0 {
			t.Fatalf("LLM assessment was dropped or replaced by similarity: %+v", d)
		}
		wantRate := math.Round(float64(want+18)/7*10) / 10
		if result.AIRate == nil || *result.AIRate != wantRate || result.Coverage != .6 || result.ModelCalls != 1 {
			t.Fatalf("LLM sample value was not counted: %+v", result)
		}
	}
	if calls != 2 {
		t.Fatal("separate detections reused an old model result")
	}
}

func TestUnknownZeroMatchSampleScoreRetriesModelInsteadOfFillingDefault(t *testing.T) {
	for _, corrected := range []bool{true, false} {
		client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 2048)
		calls := 0
		client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
			calls++
			if calls == 2 {
				var request chatRequest
				if err := json.NewDecoder(req.Body).Decode(&request); err != nil {
					t.Fatal(err)
				}
				if len(request.Messages) != 4 || !strings.Contains(request.Messages[3].Content, "sampleSources") {
					t.Fatal("correction did not request a source-based LLM assessment")
				}
				if corrected {
					return jsonResponse(aiSampleAssessmentResult(43)), nil
				}
			}
			return jsonResponse(validAIResult), nil
		})
		result, err := client.DetectAICode(context.Background(), domain.Assignment{Language: "Python"}, "value = 1\nprint(value)", domain.AIDetectionContext{SampleBank: zeroMatchSampleBank()})
		if calls != 2 {
			t.Fatal("missing sample score did not trigger model correction")
		}
		if corrected {
			if err != nil || !result.Dimensions[3].Included || *result.Dimensions[3].Score != 43 || result.ModelCalls != 2 {
				t.Fatalf("corrected model score not retained: %+v %v", result, err)
			}
		} else if !errors.Is(err, ErrAISampleAssessment) || result.ScoringVersion != "" {
			t.Fatalf("missing score silently succeeded or was replaced with a default: %+v %v", result, err)
		}
	}
}

func TestComparisonBasisCannotInventMatchesOrRequireScoreEqualToSimilarity(t *testing.T) {
	d := aiDimensionFixture(t)
	score := 73
	d[3] = domain.AIDimension{Key: "sample_match", Status: "assessed", Score: &score, Strength: "moderate", Reason: "whole implementation comparison", Alternative: "task requirements", Evidence: []domain.AIEvidence{}}
	v := aiVerification{SampleComparison: completedSampleComparison(0, 0, 0)}
	if err := requireAISampleAssessment(d, v.SampleComparison); err != nil {
		t.Fatal(err)
	}
	if err := validateAIDimensions(d, []string{"value = 1", "print(value)"}, v); err != nil || *d[3].Score != 73 || d[3].Strength != "moderate" {
		t.Fatal("server overwrote independent model score/strength", err)
	}
	d[3].Evidence = []domain.AIEvidence{{MatchID: "invented", Explanation: "invented match"}}
	if err := validateAIDimensions(d, []string{"value = 1", "print(value)"}, v); !errors.Is(err, ErrAIEvidence) {
		t.Fatal("comparison basis bypassed validation of supplied quotations")
	}
	for _, comparison := range []*domain.AISampleComparison{nil, {Status: "unavailable"}, completedSampleComparison(0, 0), completedSampleComparison(-1, 0, 0), completedSampleComparison(101, 0, 0), completedSampleComparison(math.NaN(), 0, 0), completedSampleComparison(math.Inf(1), 0, 0)} {
		if completeAISampleComparison(comparison) {
			t.Fatal("incomplete or invalid statistics accepted")
		}
	}
}

func TestReadingSavedZeroMatchesDoesNotFabricateANewLLMScore(t *testing.T) {
	for _, version := range []string{"dimensions-v5", "dimensions-v6"} {
		old := domain.AIDetection{ScoringVersion: version, Status: "estimated", Dimensions: aiDimensionFixture(t), SampleComparison: completedSampleComparison(0, 0, 0), ModelCalls: 1}
		before, _ := json.Marshal(old)
		result := RecalculateAIScoring(old)
		if result.Dimensions[3].Score != nil || result.Dimensions[3].Included || result.ModelCalls != 1 {
			t.Fatal("old report reading invented a new assessment instead of requiring explicit regeneration")
		}
		after, _ := json.Marshal(old)
		if string(before) != string(after) {
			t.Fatal("projection changed stored analysis")
		}
	}
}
