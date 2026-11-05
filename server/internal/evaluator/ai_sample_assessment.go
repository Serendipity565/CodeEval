package evaluator

import (
	"errors"
	"fmt"
	"math"

	"codeeval/server/internal/domain"
)

var ErrAISampleAssessment = errors.New("同题样本已完成比对，但 AI 未返回有效的样本维度评分，请重新识别")

// Zero matching tokens is a completed observation. It is not a score, and must
// never overwrite the model's independent assessment of the implementations.
func completeAISampleComparison(comparison *domain.AISampleComparison) bool {
	if comparison == nil || comparison.Status != "compared" || len(comparison.Samples) != AISampleExpectedCount {
		return false
	}
	seen := map[string]bool{}
	for _, sample := range comparison.Samples {
		similarity := sample.Pair.Similarity
		if sample.ID == "" || seen[sample.ID] || math.IsNaN(similarity) || math.IsInf(similarity, 0) || similarity < 0 || similarity > 100 {
			return false
		}
		seen[sample.ID] = true
	}
	return true
}

// The server records the factual basis, but leaves score, strength, reasoning
// and alternatives entirely as returned by the model. An omitted score retries
// the model; it is never replaced by zero, similarity, or a neutral default.
func requireAISampleAssessment(dimensions []domain.AIDimension, comparison *domain.AISampleComparison) error {
	if !completeAISampleComparison(comparison) {
		return nil
	}
	for i := range dimensions {
		d := &dimensions[i]
		if d.Key != "sample_match" {
			continue
		}
		if d.Status != "assessed" || d.Score == nil {
			return fmt.Errorf("%w: sample_match must be assessed with an integer score 0..100; analyze all three numbered sampleSources and the comparison statistics even when sampleEvidence is empty; zero token matches do not require a zero score; return reason, alternative, weak/moderate/strong strength and evidence=[] when no verified matchId is available", ErrAISampleAssessment)
		}
		d.EvidenceBasis = "sample_comparison"
		return nil
	}
	return fmt.Errorf("%w: sample_match dimension is missing", ErrAISampleAssessment)
}
