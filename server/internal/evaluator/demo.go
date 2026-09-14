package evaluator

import (
	"codeeval/server/internal/domain"
	"strings"
	"time"
)

// Evaluate is intentionally deterministic for the starter project. Replace it with
// a queue-backed evidence pipeline before connecting a real sandbox or LLM provider.
func Evaluate(code string, rubric []domain.RubricItem) domain.Evaluation {
	score := 74
	if strings.Contains(code, "map[") {
		score += 12
	}
	if strings.Contains(code, "//") {
		score += 4
	}
	return domain.Evaluation{Total: score, MaxTotal: 100, Status: "graded", Provider: "rules", Summary: "规则评估已生成，等待教师按证据复核。", ReviewedAt: time.Now(), Dimensions: []domain.DimensionScore{{Key: "correctness", Name: "功能正确性", Score: 36, MaxScore: 45, Evidence: "演示评估尚未运行真实测试。", Suggestion: "接入隔离测试执行器后确认。"}, {Key: "robustness", Name: "边界与鲁棒性", Score: 15, MaxScore: 20, Evidence: "已完成基础结构扫描。", Suggestion: "补充空输入与无解用例。"}, {Key: "quality", Name: "代码质量", Score: 14, MaxScore: 20, Evidence: "已完成基础代码结构检查。", Suggestion: "补充命名与关键决策的注释。"}, {Key: "efficiency", Name: "算法效率", Score: score - 65, MaxScore: 15, Evidence: "基于语法特征的暂估。", Suggestion: "在反馈中展示复杂度推导证据。"}}}
}
