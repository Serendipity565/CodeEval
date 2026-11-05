package evaluator

import (
	"fmt"
	"strings"

	"codeeval/server/internal/domain"
)

// Both sides of a historical/sample citation must resolve to server-provided
// material. AI sample citations additionally must lie within a verified match.
func validateAIComparisonEvidence(key string, evidence *domain.AIEvidence, verification aiVerification) error {
	if key != "sample_match" && key != "history" {
		if evidence.SourceID != "" || evidence.SourceCitationID != "" || evidence.SourceQuote != "" || evidence.SourceStartLine != 0 || evidence.SourceEndLine != 0 || evidence.MatchID != "" {
			return fmt.Errorf("source comparison fields are only allowed in sample_match or history")
		}
		return nil
	}
	var source string
	var matches []domain.SimilarityMatch
	if key == "history" {
		// A single supplied historical source is unambiguous even when the model
		// omits its ID. An invented ID or several possible sources remain errors.
		if evidence.SourceID == "" {
			available := []string{}
			for _, version := range verification.History {
				if !version.Omitted && len(version.Source) > 0 {
					available = append(available, version.SubmissionID)
				}
			}
			if len(available) == 1 {
				evidence.SourceID = available[0]
			}
		}
		for _, version := range verification.History {
			if version.SubmissionID == evidence.SourceID && !version.Omitted && len(version.Source) > 0 {
				lines := make([]string, len(version.Source))
				for i, line := range version.Source {
					lines[i] = line.Code
				}
				source = strings.Join(lines, "\n")
			}
		}
	} else if verification.SampleComparison != nil && verification.SampleComparison.Status == "compared" {
		for _, sample := range verification.SampleComparison.Samples {
			if sample.ID == evidence.SourceID {
				source = sample.Code
				matches = sample.Pair.Matches
				break
			}
		}
	}
	if source == "" || evidence.SourceID == "" {
		return fmt.Errorf("%w: %s needs an available source ID", ErrAIEvidence, key)
	}
	lines := strings.Split(strings.ReplaceAll(source, "\r\n", "\n"), "\n")
	reference := domain.AIEvidence{StartLine: evidence.SourceStartLine, EndLine: evidence.SourceEndLine, Quote: evidence.SourceQuote, Explanation: evidence.Explanation}
	if key == "history" {
		reference.CitationID = evidence.SourceCitationID
		if err := resolveAICurrentEvidence("history", &reference, lines); err != nil {
			return fmt.Errorf("%w: historical reference: %v", ErrAIEvidence, err)
		}
		if reference.Quote == "" {
			quote, err := aiQuoteAtRange(lines, reference.StartLine, reference.EndLine)
			if err != nil {
				return fmt.Errorf("%w: historical reference: %v", ErrAIEvidence, err)
			}
			reference.Quote = quote
		}
		if err := normalizeAIEvidence(&reference, lines); err != nil {
			return fmt.Errorf("%w: historical reference: %v", ErrAIEvidence, err)
		}
	} else {
		if evidence.SourceCitationID != "" {
			return fmt.Errorf("%w: sourceCitationId is only valid for historical code", ErrAIEvidence)
		}
		containsPair := func(ref domain.AIEvidence) bool {
			for _, match := range matches {
				if evidence.StartLine >= match.A.StartLine && evidence.EndLine <= match.A.EndLine && ref.StartLine >= match.B.StartLine && ref.EndLine <= match.B.EndLine {
					return true
				}
			}
			return false
		}
		candidate := reference
		if err := normalizeAIEvidence(&candidate, lines); err == nil && containsPair(candidate) {
			reference = candidate
		} else {
			// If a short quote is repeated elsewhere, search only the sample ranges
			// paired to this current-code quote. Never repair into an unrelated region.
			candidates := map[[2]int]domain.AIEvidence{}
			for _, match := range matches {
				if evidence.StartLine < match.A.StartLine || evidence.EndLine > match.A.EndLine || match.B.StartLine < 1 || match.B.EndLine > len(lines) || match.B.EndLine < match.B.StartLine {
					continue
				}
				candidate = reference
				offset := match.B.StartLine - 1
				candidate.StartLine -= offset
				candidate.EndLine -= offset
				if err := normalizeAIEvidence(&candidate, lines[offset:match.B.EndLine]); err != nil {
					continue
				}
				candidate.StartLine += offset
				candidate.EndLine += offset
				candidates[[2]int{candidate.StartLine, candidate.EndLine}] = candidate
			}
			if len(candidates) != 1 {
				return fmt.Errorf("%w: sample reference cannot be uniquely located inside its verified match", ErrAIEvidence)
			}
			for _, candidate := range candidates {
				reference = candidate
			}
		}
	}
	evidence.SourceStartLine, evidence.SourceEndLine, evidence.SourceQuote = reference.StartLine, reference.EndLine, reference.Quote
	return nil
}
