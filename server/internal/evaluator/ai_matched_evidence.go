package evaluator

import (
	"fmt"
	"strings"

	"codeeval/server/internal/domain"
)

// These IDs are generated only for token-verified pairs. The model selects an
// entry and explains it; the server owns both quotations and both line ranges.
type aiMatchedEvidence struct {
	ID              string `json:"id"`
	SourceID        string `json:"sourceId"`
	StartLine       int    `json:"startLine"`
	EndLine         int    `json:"endLine"`
	Quote           string `json:"quote"`
	SourceStartLine int    `json:"sourceStartLine"`
	SourceEndLine   int    `json:"sourceEndLine"`
	SourceQuote     string `json:"sourceQuote"`
}

func aiMatchedEvidenceCatalog(code string, comparison *domain.AISampleComparison) []aiMatchedEvidence {
	out := []aiMatchedEvidence{}
	if comparison == nil || comparison.Status != "compared" {
		return out
	}
	current := strings.Split(strings.ReplaceAll(code, "\r\n", "\n"), "\n")
	for _, sample := range comparison.Samples {
		source := strings.Split(strings.ReplaceAll(sample.Code, "\r\n", "\n"), "\n")
		for i, match := range sample.Pair.Matches {
			if match.A.StartLine < 1 || match.A.EndLine < match.A.StartLine || match.A.EndLine > len(current) || match.B.StartLine < 1 || match.B.EndLine < match.B.StartLine || match.B.EndLine > len(source) {
				continue
			}
			// Bound duplicated context while retaining exact, contiguous source.
			end, sourceEnd := match.A.EndLine, match.B.EndLine
			if end > match.A.StartLine+11 {
				end = match.A.StartLine + 11
			}
			if sourceEnd > match.B.StartLine+11 {
				sourceEnd = match.B.StartLine + 11
			}
			out = append(out, aiMatchedEvidence{ID: fmt.Sprintf("%s:match-%d", sample.ID, i+1), SourceID: sample.ID, StartLine: match.A.StartLine, EndLine: end, Quote: strings.Join(current[match.A.StartLine-1:end], "\n"), SourceStartLine: match.B.StartLine, SourceEndLine: sourceEnd, SourceQuote: strings.Join(source[match.B.StartLine-1:sourceEnd], "\n")})
		}
	}
	return out
}

func resolveAIMatchedEvidence(key string, evidence *domain.AIEvidence, verification aiVerification) error {
	if evidence.MatchID == "" {
		return nil
	}
	if key != "sample_match" {
		return fmt.Errorf("%w: matched-fragment IDs are only valid in sample_match", ErrAIEvidence)
	}
	for _, entry := range verification.SampleEvidence {
		if entry.ID != evidence.MatchID {
			continue
		}
		if evidence.SourceID != "" && evidence.SourceID != entry.SourceID {
			return fmt.Errorf("%w: matched-fragment source does not agree with its ID", ErrAIEvidence)
		}
		evidence.StartLine, evidence.EndLine, evidence.Quote = entry.StartLine, entry.EndLine, entry.Quote
		evidence.SourceID, evidence.SourceStartLine, evidence.SourceEndLine, evidence.SourceQuote = entry.SourceID, entry.SourceStartLine, entry.SourceEndLine, entry.SourceQuote
		return nil
	}
	return fmt.Errorf("%w: unknown matched-fragment ID", ErrAIEvidence)
}
