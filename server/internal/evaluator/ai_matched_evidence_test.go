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

func sampleEvidenceFixture() aiVerification {
	return aiVerification{SampleComparison: &domain.AISampleComparison{Status: "compared", Samples: []domain.AISampleMatch{{ID: "ai-sample-1", Code: "prefix\r\n    total += item * item\r\nsuffix", Pair: domain.SimilarityPair{Matches: []domain.SimilarityMatch{{A: domain.SimilarityRange{StartLine: 2, EndLine: 2}, B: domain.SimilarityRange{StartLine: 2, EndLine: 2}}}}}}}}
}

func TestAISampleReferenceRepairsOnlyWithinVerifiedPair(t *testing.T) {
	for _, tc := range []struct {
		name, quote string
		line        int
		wantErr     bool
	}{
		{"miscount and indentation", "total += item * item", 99, false},
		{"actual but outside pair", "suffix", 3, true},
		{"invented", "total -= item * item", 99, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			v := sampleEvidenceFixture()
			e := domain.AIEvidence{StartLine: 2, EndLine: 2, Explanation: "对照事实", SourceID: "ai-sample-1", SourceStartLine: tc.line, SourceEndLine: tc.line, SourceQuote: tc.quote}
			err := validateAIComparisonEvidence("sample_match", &e, v)
			if (err != nil) != tc.wantErr {
				t.Fatalf("error=%v", err)
			}
			if err == nil && (e.SourceStartLine != 2 || e.SourceEndLine != 2 || e.SourceQuote != "    total += item * item") {
				t.Fatalf("wrong canonical reference: %+v", e)
			}
		})
	}
}

func TestAISampleReferenceDisambiguatesOnlyPairedRanges(t *testing.T) {
	v := sampleEvidenceFixture()
	v.SampleComparison.Samples[0].Code = "    total += item * item\n    total += item * item\nother"
	e := domain.AIEvidence{StartLine: 2, EndLine: 2, Explanation: "对照事实", SourceID: "ai-sample-1", SourceStartLine: 99, SourceEndLine: 99, SourceQuote: "total += item * item"}
	if err := validateAIComparisonEvidence("sample_match", &e, v); err != nil || e.SourceStartLine != 2 {
		t.Fatalf("unique paired quote rejected: %+v %v", e, err)
	}
	v.SampleComparison.Samples[0].Pair.Matches[0].B.StartLine = 1
	e.SourceStartLine, e.SourceEndLine = 99, 99
	if err := validateAIComparisonEvidence("sample_match", &e, v); err == nil {
		t.Fatal("ambiguous paired quote accepted")
	}
}

func TestAIHistoryReferenceRepairsRealQuoteAndPreservesLiteralSpaces(t *testing.T) {
	v := aiVerification{History: []aiPriorVersion{{SubmissionID: "old", Source: aiSource("header\n    print(\"a  b\")")}}}
	e := domain.AIEvidence{Explanation: "真实历史对照", SourceID: "old", SourceStartLine: 99, SourceEndLine: 99, SourceQuote: "print(\"a  b\")"}
	if err := validateAIComparisonEvidence("history", &e, v); err != nil || e.SourceStartLine != 2 {
		t.Fatalf("history correction failed: %+v %v", e, err)
	}
	e.SourceQuote = "print(\"a b\")"
	if err := validateAIComparisonEvidence("history", &e, v); err == nil {
		t.Fatal("changed string literal accepted")
	}
}

func TestAIMatchedEvidenceCatalogBoundsAndRejectsInvalidSelection(t *testing.T) {
	var lines []string
	for i := 0; i < 20; i++ {
		lines = append(lines, fmt.Sprintf("value_%d = %d", i, i))
	}
	code := strings.Join(lines, "\n")
	v := sampleEvidenceFixture()
	v.SampleComparison.Samples[0].Code = code
	v.SampleComparison.Samples[0].Pair.Matches[0] = domain.SimilarityMatch{A: domain.SimilarityRange{StartLine: 1, EndLine: 20}, B: domain.SimilarityRange{StartLine: 1, EndLine: 20}}
	v.SampleEvidence = aiMatchedEvidenceCatalog(code, v.SampleComparison)
	if len(v.SampleEvidence) != 1 || v.SampleEvidence[0].EndLine != 12 || v.SampleEvidence[0].SourceEndLine != 12 {
		t.Fatalf("catalog not bounded: %+v", v.SampleEvidence)
	}
	for _, tc := range []struct{ key, id, source string }{
		{"sample_match", "invented", ""}, {"history", v.SampleEvidence[0].ID, ""}, {"sample_match", v.SampleEvidence[0].ID, "other-sample"},
	} {
		e := domain.AIEvidence{MatchID: tc.id, SourceID: tc.source}
		if err := resolveAIMatchedEvidence(tc.key, &e, v); err == nil {
			t.Fatalf("invalid selection accepted: %+v", tc)
		}
	}
	var input struct {
		Verification aiVerification `json:"verification"`
	}
	if err := json.Unmarshal([]byte(aiDetectionInput(domain.Assignment{}, code, v)), &input); err != nil {
		t.Fatal(err)
	}
	if input.Verification.SampleComparison.Samples[0].Code != "" || v.SampleComparison.Samples[0].Code != code || len(input.Verification.SampleEvidence) != 1 {
		t.Fatal("payload missing excerpts or mutated validation source")
	}
}

func TestAIDetectionAcceptsServerMatchedIDWithoutModelLineCounting(t *testing.T) {
	code := "value = 1\nprint(value)\nvalues = [1, 2, 3, 4]\ntotal = 0\nfor item in values:\n    total += item * item\nprint(total)"
	a := domain.Assignment{Language: "Python"}
	v := buildAIVerification(context.Background(), a, code, domain.AIDetectionContext{SampleBank: &domain.AISampleBank{Samples: []domain.AISample{{ID: "ai-sample-1", Code: code}}}})
	if len(v.SampleEvidence) == 0 {
		t.Fatal("fixture has no token match")
	}
	d := aiDimensionFixture(t)
	score := 2
	d[3] = domain.AIDimension{Key: "sample_match", Status: "assessed", Score: &score, Strength: "moderate", Reason: "服务端已核验匹配", Alternative: "也可能是标准解法", Evidence: []domain.AIEvidence{{MatchID: v.SampleEvidence[0].ID, Explanation: "已核验的同题片段"}}}
	output := mustJSON(map[string]any{"summary": "具体匹配事实与人工解释", "dimensions": d, "limitations": []string{}})
	client := NewDeepSeekClient("https://example.invalid/v1", "key", "model", 2, 2048)
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) { return jsonResponse(output), nil })
	result, err := client.detectAICode(context.Background(), a, code, v)
	if err != nil {
		t.Fatal(err)
	}
	e := result.Dimensions[3].Evidence[0]
	if e.StartLine != v.SampleEvidence[0].StartLine || e.SourceQuote != v.SampleEvidence[0].SourceQuote || e.SourceID != "ai-sample-1" {
		t.Fatalf("selected ID not resolved: %+v", e)
	}
}

func TestAIEvidenceRetryRequestsSourceCorrection(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid/v1", "key", "model", 2, 2048)
	calls := 0
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return jsonResponse(strings.Replace(validAIResult, `"quote":"value = 1"`, `"quote":"invented()"`, 1)), nil
		}
		var request chatRequest
		if err := json.NewDecoder(req.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		feedback := request.Messages[len(request.Messages)-1].Content
		if !strings.Contains(feedback, "dimension task_fit, evidence 1") || !strings.Contains(feedback, "matchId") || !strings.Contains(feedback, "currentEvidence.id") || !strings.Contains(feedback, "不能改成 insufficient_evidence") {
			t.Fatalf("citation repair guidance missing: %s", feedback)
		}
		return jsonResponse(validAIResult), nil
	})
	result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	if err != nil || result.ModelCalls != 2 {
		t.Fatalf("citation correction retry failed: %v calls=%d", err, result.ModelCalls)
	}
}
