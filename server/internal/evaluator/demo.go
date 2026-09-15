package evaluator

import (
	"codeeval/server/internal/domain"
	"strconv"
	"time"
)

// Evaluate is intentionally deterministic for the starter project. Replace it with
// a queue-backed evidence pipeline before connecting a real sandbox or LLM provider.
func Evaluate(code string, rubric []domain.RubricItem) domain.Evaluation {
	evidence := AnalyzeStatic("unknown", code)
	dimensions := make([]domain.DimensionScore, 0, len(rubric))
	total := 0
	for _, item := range rubric {
		// The local path is deliberately conservative: without a compiler and
		// tests it must not manufacture a functional-correctness score.
		score := item.Weight / 2
		total += score
		dimensions = append(dimensions, domain.DimensionScore{
			Key: item.Key, Name: item.Name, Criterion: item.Description, Score: score, MaxScore: item.Weight,
			Evidence:   "仅完成静态词法扫描，未编译或运行代码。",
			Suggestion: "启用大模型评估，或接入隔离测试执行器后再确认该项。",
		})
	}
	return domain.Evaluation{
		Total: total, MaxTotal: 100, Status: "needs_review", Provider: "rules",
		Summary:      "本地扫描发现 " + strconv.Itoa(len(evidence.Warnings)) + " 条提示；当前分数是待复核占位值，不能作为功能正确性结论。",
		Strengths:    []string{"已完成代码提交，可按教师量规进一步复核。"},
		Issues:       []string{"未编译或运行代码，当前无法验证功能正确性。"},
		Improvements: []string{"启用大模型评估或接入隔离测试执行器，再按教师量规确认得分。"},
		ReviewedAt:   time.Now(), Dimensions: dimensions,
	}
}
