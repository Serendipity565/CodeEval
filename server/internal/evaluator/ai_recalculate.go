package evaluator

import (
	"strings"

	"codeeval/server/internal/domain"
)

// RecalculateAIScoring projects a saved percentage report using its previously
// verified raw analysis values. It never calls a model or updates stored data.
// Earlier 4/10-point reports retain their original scales and snapshots.
func RecalculateAIScoring(previous domain.AIDetection) domain.AIDetection {
	if previous.ScoringVersion != "dimensions-v5" || validateAIDimensionShapes(previous.Dimensions) != nil {
		return previous
	}
	dimensions := append([]domain.AIDimension{}, previous.Dimensions...)
	calculated := aggregateAIDimensionsWithPolicy(dimensions, "dimensions-v6")
	result := previous
	result.Status, result.AIRate, result.Coverage = calculated.Status, calculated.AIRate, calculated.Coverage
	result.Dimensions, result.Evidence = calculated.Dimensions, calculated.Evidence
	// Reading an old report cannot create a new LLM assessment. Preserve the v6
	// projection policy; reports missing a sample score need explicit regeneration.
	result.ScoringVersion, result.RecalculatedFromVersion = "dimensions-v6", previous.ScoringVersion
	calculated.AggregationNotes[3] = "同题样本维度沿用原模型的已保存分析值；缺失分析值不会用匹配率或零分填充。重新生成后，即使没有连续匹配片段也由模型分析评分。"
	result.AggregationNotes = append(calculated.AggregationNotes, "基于已保存报告中已核验的原始维度分析值按现行规则重新汇总；未重新调用模型，原始报告未覆盖，识别时间仍为原分析时间。")
	result.Summary = calculated.Summary
	// Preserve the model's factual explanation, excluding the previous computed
	// classification prefix. Reports without an estimate had no retained summary.
	if previous.Status == "estimated" {
		if _, facts, found := strings.Cut(previous.Summary, "，由各维度证据按固定规则综合得出。"); found && strings.TrimSpace(facts) != "" {
			result.Summary += " " + strings.TrimSpace(facts)
		}
	}
	return result
}
