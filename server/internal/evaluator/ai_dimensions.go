package evaluator

import (
	"fmt"
	"math"
	"strings"

	"codeeval/server/internal/domain"
)

const aiScoringVersion = "dimensions-v7"
const aiDimensionMaxScore = 100

// These experimental product weights are not fitted probabilities.
var aiDimensionRules = []struct {
	key, label string
	weight     int
}{
	{"task_fit", "题目与实现契合", 20},
	{"structure", "代码结构与表达", 20},
	{"comments", "注释与代码关系", 20},
	{"sample_match", "同题 AI 样本匹配", 20},
	{"history", "学生历史与提交演变", 20},
}

func validateAIDimensionShapes(dimensions []domain.AIDimension) error {
	if len(dimensions) != len(aiDimensionRules) {
		return fmt.Errorf("exactly five dimensions are required")
	}
	seen := map[string]bool{}
	for i := range dimensions {
		d := &dimensions[i]
		known := false
		for _, rule := range aiDimensionRules {
			known = known || d.Key == rule.key
		}
		if !known || seen[d.Key] {
			return fmt.Errorf("unknown or duplicate dimension: %s", d.Key)
		}
		seen[d.Key] = true
		if d.EvidenceBasis != "" && (d.Key != "sample_match" || d.EvidenceBasis != "sample_comparison") {
			return fmt.Errorf("invalid evidence basis for dimension %s", d.Key)
		}
		if strings.TrimSpace(d.Reason) == "" || d.Evidence == nil {
			return fmt.Errorf("dimension %s needs a reason and evidence array", d.Key)
		}
		if d.Status == "insufficient_evidence" {
			if d.Score != nil || d.Strength != "none" || len(d.Evidence) != 0 {
				return fmt.Errorf("unknown dimension %s must have null score, none strength and empty evidence", d.Key)
			}
			continue
		}
		sampleAnalysis := d.Key == "sample_match" && d.EvidenceBasis == "sample_comparison"
		if d.Status != "assessed" || d.Score == nil || *d.Score < 0 || *d.Score > aiDimensionMaxScore || strings.TrimSpace(d.Alternative) == "" || (!sampleAnalysis && len(d.Evidence) == 0) || len(d.Evidence) > 4 {
			return fmt.Errorf("assessed dimension %s needs integer score 0..100, alternative explanation and 1..4 quotes (sample_comparison may have no matched quotes)", d.Key)
		}
		if strengthRank(d.Strength) == 0 {
			return fmt.Errorf("invalid evidence strength for dimension %s", d.Key)
		}
	}
	return nil
}

func validateAIDimensions(dimensions []domain.AIDimension, lines []string, materials ...aiVerification) error {
	if err := validateAIDimensionShapes(dimensions); err != nil {
		return err
	}
	var verification aiVerification
	if len(materials) > 0 {
		verification = materials[0]
	}
	for i := range dimensions {
		if err := validateAIDimensionEvidence(&dimensions[i], lines, verification); err != nil {
			return err
		}
	}
	return nil
}

func validateAIDimensionEvidence(d *domain.AIDimension, lines []string, verification aiVerification) error {
	if d.EvidenceBasis == "sample_comparison" {
		if !completeAISampleComparison(verification.SampleComparison) {
			return fmt.Errorf("%w: sample analysis requires a completed three-sample comparison", ErrAIEvidence)
		}
	}
	for j := range d.Evidence {
		e := &d.Evidence[j]
		if err := resolveAICurrentEvidence(d.Key, e, lines); err != nil {
			return fmt.Errorf("dimension %s, evidence %d: %w", d.Key, j+1, err)
		}
		if err := resolveAIMatchedEvidence(d.Key, e, verification); err != nil {
			return fmt.Errorf("dimension %s, evidence %d: %w", d.Key, j+1, err)
		}
		if e.Quote == "" {
			if d.Key == "sample_match" {
				return fmt.Errorf("%w: dimension sample_match needs a verified matchId", ErrAIEvidence)
			}
			quote, err := aiQuoteAtRange(lines, e.StartLine, e.EndLine)
			if err != nil {
				return fmt.Errorf("%w: dimension %s, evidence %d: %v", ErrAIEvidence, d.Key, j+1, err)
			}
			e.Quote = quote
		}
		if err := normalizeAIEvidence(e, lines); err != nil {
			return fmt.Errorf("%w: dimension %s, evidence %d: %v", ErrAIEvidence, d.Key, j+1, err)
		}
		if err := validateAIComparisonEvidence(d.Key, e, verification); err != nil {
			return fmt.Errorf("%w: dimension %s, evidence %d: %v", ErrAIEvidence, d.Key, j+1, err)
		}
	}
	return nil
}

// Extract actual source for range-only citations; never repair a supplied but
// fabricated quote merely because it has valid line numbers.
func aiQuoteAtRange(lines []string, start, end int) (string, error) {
	if start < 1 || end < start || end > len(lines) || end-start >= 20 {
		return "", fmt.Errorf("source range must contain 1..20 available lines")
	}
	quote := strings.Join(lines[start-1:end], "\n")
	if strings.TrimSpace(quote) == "" {
		return "", fmt.Errorf("source range is blank")
	}
	return quote, nil
}

func strengthRank(strength string) int {
	switch strength {
	case "weak":
		return 1
	case "moderate":
		return 2
	case "strong":
		return 3
	}
	return 0
}

func normalizedAIQuote(quote string) string {
	lines := strings.Split(strings.ReplaceAll(quote, "\r\n", "\n"), "\n")
	for i := range lines {
		lines[i] = strings.TrimSpace(lines[i])
	}
	return strings.Join(lines, "\n")
}

func aggregateAIDimensions(input []domain.AIDimension, _ string) domain.AIDetection {
	result := domain.AIDetection{
		Status: "insufficient_evidence", ScoringVersion: aiScoringVersion,
		Evidence: []domain.AIEvidence{}, Dimensions: []domain.AIDimension{},
		AggregationNotes: []string{
			"实验权重：题目契合、代码结构、注释关系、同题 AI 样本、历史演变各 20%；分数与证据强度来自模型分析，权重未经准确率校准。",
			"各维度分别按原始分析值参与汇总；引用相同或行范围重叠不会排除维度。公共框架和标准算法本身不能证明来源，由各维度分析说明。",
			"有已核验依据和分析值的维度均参与综合结果，不因证据强弱、低分或引用复用而排除；每维只按其基础权重计入一次。没有材料或引用未通过核验时标为无法判断，不捏造百分比、不记为零分。",
			"同题样本维度由模型结合当前实现、三份样本源码和服务端比对统计给出 0–100% 的生成倾向值。没有连续匹配片段仍须评分并参与计算；匹配率不直接充当维度分数，零匹配不自动记零分。证据强度由模型单独评估。",
		},
	}
	// Canonical order, labels, weights and all calculated fields are server-owned.
	for _, rule := range aiDimensionRules {
		for _, supplied := range input {
			if supplied.Key == rule.key {
				d := supplied
				d.Label, d.Weight = rule.label, rule.weight
				d.Included, d.EffectiveScore, d.ExclusionReason = false, nil, ""
				d.Evidence = append([]domain.AIEvidence{}, supplied.Evidence...)
				for i := range d.Evidence {
					d.Evidence[i].Counted = false
				}
				result.Dimensions = append(result.Dimensions, d)
			}
		}
	}
	weight, weightedScore, includedCount := 0, 0, 0
	for i := range result.Dimensions {
		d := &result.Dimensions[i]
		d.Included = d.Status == "assessed" && d.Score != nil && (len(d.Evidence) > 0 || d.EvidenceBasis == "sample_comparison")
		for j := range d.Evidence {
			d.Evidence[j].Counted = d.Included
			result.Evidence = append(result.Evidence, d.Evidence[j])
		}
		if !d.Included {
			d.ExclusionReason = "缺少可用材料、分析值或已核验引用，无法判断"
			continue
		}
		score := *d.Score
		d.EffectiveScore = &score
		weight += d.Weight
		weightedScore += score * d.Weight
		includedCount++
	}
	result.Coverage = float64(weight) / 100
	if includedCount == 0 {
		result.Summary = fmt.Sprintf("无法判断，暂不生成综合结果。%d/%d 个维度有可用分析值；缺少材料不代表低生成倾向。", includedCount, len(result.Dimensions))
		return result
	}
	rate := math.Round(float64(weightedScore)/float64(aiDimensionMaxScore*weight)*1000) / 10
	result.AggregationNotes = append(result.AggregationNotes, fmt.Sprintf("按参与维度重新归一化：Σ(维度生成倾向百分比 × 权重) ÷ 参与权重合计；本次 %d/%d 个维度参与，权重覆盖 %d%%，综合分为 %.1f%%。每维使用 0–100%% 的整数倾向值，仅作为统一量表，证据强度不改变计算。", includedCount, len(result.Dimensions), weight, rate))
	result.Status, result.AIRate = "estimated", &rate
	label := "低生成倾向"
	switch {
	case rate >= 80:
		label = "高生成倾向"
	case rate >= 50:
		label = "较高生成倾向"
	case rate >= 30:
		label = "部分生成倾向"
	}
	result.Summary = label + "，由各维度证据按固定规则综合得出。"
	return result
}
