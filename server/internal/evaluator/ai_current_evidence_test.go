package evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"codeeval/server/internal/domain"
)

func TestCurrentEvidenceIDsAnchorRepeatedCodeWithoutModelLineCounting(t *testing.T) {
	lines := []string{}
	for i := 0; i < 250; i++ {
		lines = append(lines, "    value = value + 1")
	}
	catalog := aiCurrentEvidenceCatalog(lines)
	if len(catalog) != 21 || catalog[20].EndLine != 250 {
		t.Fatal("source blocks omitted tail or exceeded source")
	}
	d := aiDimensionFixture(t)
	d[0].Evidence = []domain.AIEvidence{{CitationID: "code-020", StartLine: 999, EndLine: 1000, Explanation: "repeated operation"}}
	d[1].Evidence = []domain.AIEvidence{{CitationID: "code-021", Explanation: "tail implementation"}}
	if err := validateAIDimensions(d, lines); err != nil {
		t.Fatal(err)
	}
	if d[0].Evidence[0].StartLine != 229 || d[0].Evidence[0].EndLine != 240 || d[1].Evidence[0].EndLine != 250 {
		t.Fatal("server did not extract exact catalog range")
	}
	for _, e := range d[0].Evidence {
		if e.Quote != strings.Join(lines[e.StartLine-1:e.EndLine], "\n") {
			t.Fatal("quote is not exact original source")
		}
	}
	for _, e := range []domain.AIEvidence{{CitationID: "code-999", Explanation: "invalid id"}, {CitationID: "code-001", Quote: "invented()", Explanation: "invented quote"}} {
		if err := resolveAICurrentEvidence("structure", &e, lines); !errors.Is(err, ErrAIEvidence) {
			t.Fatal("invented reference accepted")
		}
	}
	if err := resolveAICurrentEvidence("sample_match", &domain.AIEvidence{CitationID: "code-001"}, lines); !errors.Is(err, ErrAIEvidence) {
		t.Fatal("current block bypassed sample comparison validation")
	}
}

func TestBothCoreDimensionsAreReassessedInsteadOfDroppedAfterCitationFailure(t *testing.T) {
	for _, secondUnknown := range []bool{false, true} {
		client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 2048)
		calls := 0
		client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
			calls++
			var request chatRequest
			if err := json.NewDecoder(req.Body).Decode(&request); err != nil {
				t.Fatal(err)
			}
			var input struct {
				CurrentEvidence []aiCurrentEvidence `json:"currentEvidence"`
				Keys            []string            `json:"dimensionsToReview"`
				Errors          []string            `json:"citationErrors"`
			}
			if err := json.Unmarshal([]byte(request.Messages[1].Content), &input); err != nil {
				t.Fatal(err)
			}
			if len(input.CurrentEvidence) != 1 || input.CurrentEvidence[0].ID != "code-001" {
				t.Fatal("request missing real citation catalog")
			}
			d := aiDimensionFixture(t)
			if calls <= 2 {
				for i := 0; i < 2; i++ {
					d[i].Evidence[0].Quote = fmt.Sprintf("invented_%d()", i)
					if calls == 2 && secondUnknown {
						d[i].Status, d[i].Score, d[i].Strength = "insufficient_evidence", nil, "none"
						d[i].Evidence = []domain.AIEvidence{}
					}
				}
				return jsonResponse(mustJSON(map[string]any{"summary": "obsolete failed claims", "dimensions": d, "limitations": []string{}})), nil
			}
			if len(input.Keys) != 2 || input.Keys[0] != "task_fit" || input.Keys[1] != "structure" || len(input.Errors) != 2 {
				t.Fatalf("repair did not locate both failed dimensions: %+v", input)
			}
			first, second := 27, 64
			d[0].Score, d[1].Score = &first, &second
			for i := 0; i < 2; i++ {
				d[i].Evidence = []domain.AIEvidence{{CitationID: "code-001", Explanation: "independently reassessed actual implementation"}}
			}
			return jsonResponse(mustJSON(map[string]any{"dimensions": d[:2]})), nil
		})
		r, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
		if err != nil || calls != 3 || r.ModelCalls != 3 || r.AIRate == nil || *r.AIRate != 45.5 || r.Coverage != .4 || r.CitationVersion != "source-blocks-v1" {
			t.Fatalf("core dimensions were lost during citation repair: %+v %v calls=%d", r, err, calls)
		}
		for _, d := range r.Dimensions[:2] {
			if !d.Included || len(d.Evidence) != 1 || d.Evidence[0].Quote != "value = 1\nprint(value)" {
				t.Fatal("repair did not preserve assessed dimension with exact source")
			}
		}
		if strings.Contains(r.Summary, "obsolete") || strings.Contains(strings.Join(r.Checks, ""), "已排除整个维度") {
			t.Fatal("failed original analysis or exclusion fallback retained")
		}
	}
}

func TestHistoryBlockIDsResolveBothRealSources(t *testing.T) {
	d := aiDimensionFixture(t)
	score := 34
	current := strings.Split(strings.Repeat("    value += 1\n", 48), "\n")
	old := strings.Repeat("    value += 2\n", 60)
	v := aiVerification{History: []aiPriorVersion{{SubmissionID: "old-1", Source: aiSource(old)}}}
	d[4] = domain.AIDimension{Key: "history", Status: "assessed", Score: &score, Strength: "weak", Reason: "actual implementation change", Alternative: "human revision", Evidence: []domain.AIEvidence{{CitationID: "code-004", SourceID: "old-1", SourceCitationID: "code-005", Explanation: "changed repeated update"}}}
	d[0].Evidence = []domain.AIEvidence{{CitationID: "code-001", Explanation: "task implementation"}}
	d[1].Evidence = []domain.AIEvidence{{CitationID: "code-002", Explanation: "implementation organization"}}
	if err := validateAIDimensions(d, current, v); err != nil {
		t.Fatal(err)
	}
	e := d[4].Evidence[0]
	if e.StartLine != 37 || e.EndLine != 48 || e.SourceStartLine != 49 || e.SourceEndLine != 60 || e.SourceQuote != strings.TrimSuffix(strings.Repeat("    value += 2\n", 12), "\n") {
		t.Fatalf("wrong source ranges or source: %+v", e)
	}
	d[4].Evidence[0].SourceCitationID = "code-999"
	if err := validateAIDimensions(d, current, v); !errors.Is(err, ErrAIEvidence) {
		t.Fatal("invented historical block accepted")
	}
}

func TestHistoryRepairAcceptsStrictlyVerifiedLegacyRanges(t *testing.T) {
	d := aiDimensionFixture(t)
	score := 34
	h := domain.AIDimension{Key: "history", Status: "assessed", Score: &score, Strength: "weak", Reason: "actual change", Alternative: "human revision", Evidence: []domain.AIEvidence{{StartLine: 1, EndLine: 2, SourceID: "old-1", SourceStartLine: 1, SourceEndLine: 2, Explanation: "compared real ranges"}}}
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 2048)
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(mustJSON(map[string]any{"dimensions": []domain.AIDimension{h}})), nil
	})
	v := aiVerification{History: []aiPriorVersion{{SubmissionID: "old-1", Source: aiSource("value = 2\nprint(value)")}}}
	out, _, calls, err := client.repairAICitations(context.Background(), domain.Assignment{}, "value = 1\nprint(value)", v, d, map[string]error{"history": ErrAIEvidence})
	if err != nil || calls != 1 || out[4].Score == nil || *out[4].Score != 34 || out[4].Evidence[0].SourceQuote != "value = 2\nprint(value)" {
		t.Fatalf("valid history source rejected by repair protocol: %+v %v", out, err)
	}
}
