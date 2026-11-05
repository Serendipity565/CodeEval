package evaluator

import (
	"errors"
	"fmt"
	"strings"

	"codeeval/server/internal/domain"
)

type aiCurrentEvidence struct {
	ID        string `json:"id"`
	StartLine int    `json:"startLine"`
	EndLine   int    `json:"endLine"`
}

// The model selects an existing block. Source, indentation and line ranges are
// always server-owned, including repeated snippets in long implementations.
func aiCurrentEvidenceCatalog(lines []string) []aiCurrentEvidence {
	out := []aiCurrentEvidence{}
	for start := 0; start < len(lines); start += 12 {
		end := start + 12
		if end > len(lines) {
			end = len(lines)
		}
		if strings.TrimSpace(strings.Join(lines[start:end], "\n")) != "" {
			out = append(out, aiCurrentEvidence{ID: fmt.Sprintf("code-%03d", start/12+1), StartLine: start + 1, EndLine: end})
		}
	}
	return out
}

func resolveAICurrentEvidence(key string, e *domain.AIEvidence, lines []string) error {
	if e.CitationID == "" {
		return nil
	}
	if key == "sample_match" || e.MatchID != "" {
		return fmt.Errorf("%w: current citationId cannot replace a sample matchId", ErrAIEvidence)
	}
	for _, block := range aiCurrentEvidenceCatalog(lines) {
		if block.ID != e.CitationID {
			continue
		}
		quote := strings.Join(lines[block.StartLine-1:block.EndLine], "\n")
		if e.Quote != "" && !strings.Contains(quote, strings.ReplaceAll(e.Quote, "\r\n", "\n")) {
			return fmt.Errorf("%w: supplied quote contradicts citationId %s", ErrAIEvidence, e.CitationID)
		}
		e.StartLine, e.EndLine, e.Quote = block.StartLine, block.EndLine, quote
		return nil
	}
	return fmt.Errorf("%w: unknown current citationId %s; select an existing currentEvidence.id", ErrAIEvidence, e.CitationID)
}

// A technical citation error in available current code must not turn an
// assessed core dimension into a successful but unknown result on retry.
func validateTrackedAIDimensions(dimensions []domain.AIDimension, lines []string, verification aiVerification, failures map[string]error) error {
	if err := validateAIDimensionShapes(dimensions); err != nil {
		return err
	}
	var problems []error
	for i := range dimensions {
		d := &dimensions[i]
		if _, failed := failures[d.Key]; failed && (d.Key == "task_fit" || d.Key == "structure") && d.Status != "assessed" {
			err := fmt.Errorf("%w: dimension %s previously had an assessment; repair its citation using currentEvidence.id instead of changing it to insufficient_evidence", ErrAIEvidence, d.Key)
			failures[d.Key] = err
			problems = append(problems, err)
			continue
		}
		if err := validateAIDimensionEvidence(d, lines, verification); err != nil {
			failures[d.Key] = err
			problems = append(problems, err)
		} else {
			delete(failures, d.Key)
		}
	}
	return errors.Join(problems...)
}
