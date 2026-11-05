package evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"codeeval/server/internal/domain"
)

func TestAIRangeOnlyCitationsUseOriginalCurrentAndHistoricalLines(t *testing.T) {
	d := aiDimensionFixture(t)
	d[0].Evidence[0].Quote, d[1].Evidence[0].Quote = "", ""
	score := 32
	d[4] = domain.AIDimension{Key: "history", Status: "assessed", Score: &score, Strength: "weak", Reason: "具体历史变化", Alternative: "可能是人工修改", Evidence: []domain.AIEvidence{{StartLine: 3, EndLine: 3, SourceStartLine: 2, SourceEndLine: 2, Explanation: "新旧行对照"}}}
	v := aiVerification{History: []aiPriorVersion{{SubmissionID: "old-1", Source: aiSource("header\r\n    print(\"a  b\")")}}}
	lines := []string{"value = 1", "print(value)", "    print(\"a b\")"}
	if err := validateAIDimensions(d, lines, v); err != nil {
		t.Fatal(err)
	}
	e := d[4].Evidence[0]
	if e.SourceID != "old-1" || e.SourceQuote != "    print(\"a  b\")" || e.Quote != lines[2] {
		t.Fatalf("range citation did not retain exact original source: %+v", e)
	}
	d[0].Evidence[0].Quote = "invented()"
	if err := validateAIDimensions(d, lines, v); !errors.Is(err, ErrAIEvidence) {
		t.Fatal("fabricated quote accepted just because line numbers were valid")
	}
	for _, r := range [][2]int{{0, 1}, {3, 2}, {1, 4}, {1, 21}} {
		if _, err := aiQuoteAtRange(lines, r[0], r[1]); err == nil {
			t.Fatalf("invalid range accepted: %v", r)
		}
	}
}

func TestAIHistoryCannotInferAmbiguousOrInventedSourceIDs(t *testing.T) {
	for _, tc := range []struct {
		id      string
		history []aiPriorVersion
	}{
		{"", nil},
		{"", []aiPriorVersion{{SubmissionID: "a", Source: aiSource("print(1)")}, {SubmissionID: "b", Source: aiSource("print(2)")}}},
		{"invented", []aiPriorVersion{{SubmissionID: "a", Source: aiSource("print(1)")}}},
		{"", []aiPriorVersion{{SubmissionID: "a", Source: aiSource("print(1)"), Omitted: true}}},
	} {
		e := domain.AIEvidence{StartLine: 1, EndLine: 1, Explanation: "对照", SourceID: tc.id, SourceStartLine: 1, SourceEndLine: 1}
		if err := validateAIComparisonEvidence("history", &e, aiVerification{History: tc.history}); !errors.Is(err, ErrAIEvidence) {
			t.Fatalf("unavailable/ambiguous source accepted: %+v", tc)
		}
	}
}

func TestAIInvalidHistoryDoesNotLoseOtherVerifiedDimensions(t *testing.T) {
	d := aiDimensionFixture(t)
	score := 99
	d[4] = domain.AIDimension{Key: "history", Status: "assessed", Score: &score, Strength: "strong", Reason: "虚构的历史", Alternative: "其他解释", Evidence: []domain.AIEvidence{{StartLine: 1, EndLine: 1, Quote: "value = 1", SourceID: "unavailable", SourceStartLine: 1, SourceEndLine: 1, SourceQuote: "invented()", Explanation: "不可核验历史"}}}
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 2048)
	calls := 0
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		if calls <= 2 {
			return jsonResponse(mustJSON(map[string]any{"summary": "obsolete claim", "dimensions": d, "limitations": []string{}})), nil
		}
		unknown := aiDimensionFixture(t)[4]
		return jsonResponse(mustJSON(map[string]any{"dimensions": []domain.AIDimension{unknown}})), nil
	})
	result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	if err != nil || result.ModelCalls != 3 || result.AIRate == nil || *result.AIRate != 3 || result.Coverage != .4 {
		t.Fatalf("bad history lost valid dimensions or inflated score: %+v %v", result, err)
	}
	h := result.Dimensions[4]
	if h.Score != nil || h.Included || h.Strength != "none" || len(h.Evidence) != 0 || !strings.Contains(strings.Join(result.Checks, ""), "history") || strings.Contains(result.Summary, "不应沿用") {
		t.Fatalf("bad history retained or not disclosed: %+v", result)
	}
}

func TestAICitationRepairNeverSalvagesBadSchema(t *testing.T) {
	d := aiDimensionFixture(t)
	*d[1].Score = 101
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 2048)
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("invalid schema reached repair request")
		return nil, nil
	})
	if _, _, calls, err := client.repairAICitations(context.Background(), domain.Assignment{}, "value = 1\nprint(value)", aiVerification{}, d, map[string]error{"structure": ErrAIEvidence}); err == nil || calls != 0 {
		t.Fatal("invalid schema silently salvaged")
	}
}

func TestAIFailedSampleGenerationNeverProducesAnEarlierPartialReport(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 2048)
	fail := true
	analyses := 0
	fingerprints := []string{}
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		var input chatRequest
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if strings.Contains(input.Messages[1].Content, `"verification"`) {
			analyses++
			var payload struct {
				Verification aiVerification `json:"verification"`
			}
			if err := json.Unmarshal([]byte(input.Messages[1].Content), &payload); err != nil {
				t.Fatal(err)
			}
			if len(payload.Verification.SampleComparison.Samples) != 3 {
				t.Fatal("analysis started with a partial sample bank")
			}
			fingerprints = append(fingerprints, payload.Verification.SampleComparison.Fingerprint)
			return jsonResponse(aiSampleAssessmentResult(43)), nil
		}
		if fail && strings.Contains(input.Messages[1].Content, `"approach":"模块化实现"`) {
			return jsonResponse(`{"code":`), nil
		}
		return jsonResponse(generatedSampleResponse(input)), nil
	})
	s := &Service{deepseek: client, maxCodeBytes: 1000, aiSampleStore: &aiSampleMemoryStore{}}
	a := domain.Assignment{ID: "2", Language: "Python"}
	if _, err := s.DetectAICode(context.Background(), a, "value = 1\nprint(value)"); err == nil || analyses != 0 {
		t.Fatal("first request silently continued with missing samples")
	}
	bank, err := s.ReadAISampleBank(context.Background(), a)
	if err != nil || len(bank.Samples) != 1 {
		t.Fatal("completed sample was not retained")
	}
	fail = false
	for i := 0; i < 2; i++ {
		if _, err := s.DetectAICode(context.Background(), a, "value = 1\nprint(value)"); err != nil {
			t.Fatal(err)
		}
	}
	if analyses != 2 || fingerprints[0] != fingerprints[1] {
		t.Fatal("later submissions used a different sample snapshot")
	}
}
