package evaluator

import (
	"codeeval/server/internal/domain"
	"time"
)

// Evaluate records observations without assigning unsupported placeholder scores.
// Execution evidence or a teacher review can supply the missing scores later.
func Evaluate(code string, rubric []domain.RubricItem) domain.Evaluation {
	return evaluateLocal("unknown", code, rubric)
}

func evaluateLocal(language, code string, rubric []domain.RubricItem) domain.Evaluation {
	evidence := AnalyzeStatic(language, code)
	findings := make([]domain.AnalysisFinding, 0, len(evidence.Warnings))
	for _, warning := range evidence.Warnings {
		findings = append(findings, domain.AnalysisFinding{Category: "static", Severity: "info", Evidence: warning, Explanation: "静态扫描提示，需结合代码由教师复核，不自动扣分。"})
	}
	dimensions := make([]domain.DimensionScore, 0, len(rubric))
	total := 0
	for _, item := range rubric {
		total += item.Weight
		dimensions = append(dimensions, domain.DimensionScore{
			Key: item.Key, Name: item.Name, Criterion: item.Description, Unscored: true, MaxScore: item.Weight,
			Evidence:   "当前规则没有足够证据评定该项，等待教师评分。",
			Suggestion: "请教师结合评分量规和提交代码确认得分。",
			Confidence: 0, Verified: false, EvidenceType: "static",
		})
	}
	return domain.Evaluation{
		MaxTotal: total, Incomplete: true, Status: "needs_review", Provider: "rules",
		Summary:      "尚无执行证据；各项等待教师评分，未生成总成绩。",
		Strengths:    []string{"已完成代码提交，可按教师量规进一步复核。"},
		Issues:       []string{"尚无执行证据，无法确认功能正确性。"},
		Improvements: []string{"结合测试结果和评分量规改进代码；未评分项由教师复核。"},
		ReviewedAt:   time.Now(), Dimensions: dimensions, Analysis: findings,
		Confidence: 0, Verified: false, EvidenceType: "static", PromptVersion: promptVersion, EvaluatorVersion: evaluatorVersion, ModelCalls: 0,
	}
}
