package domain

import "fmt"

// NormalizeLegacyEvaluation also handles stored rule evaluations from before
// explicit unscored fields existed. A placeholder must never become a grade.
// This changes the API view only; the original evaluation JSON remains intact.
func NormalizeLegacyEvaluation(e *Evaluation) {
	if e == nil || e.Provider != "rules" {
		return
	}
	e.Total, e.MaxTotal = 0, 0
	e.Incomplete = len(e.Dimensions) == 0
	e.Verified = len(e.Dimensions) > 0
	for i := range e.Dimensions {
		d := &e.Dimensions[i]
		d.Unscored = !(d.EvidenceType == "execution" && d.Verified && e.Execution != nil && e.Execution.TotalWeight > 0)
		if d.Unscored {
			d.Score = 0
			d.Confidence = 0
			d.Verified = false
			d.Evidence = "当前规则没有足够证据评定该项，等待教师评分。"
			d.Suggestion = "请教师结合评分量规和提交代码确认得分。"
			e.Incomplete = true
			e.Verified = false
		}
		e.Total += d.Score
		e.MaxTotal += d.MaxScore
	}
	e.Status = "graded"
	e.Confidence = 1
	if e.Incomplete {
		e.Status = "needs_review"
		e.Confidence = 0
	}
	if e.Execution == nil {
		e.Summary = "尚无执行证据；各项等待教师评分，未生成总成绩。"
		e.Issues = []string{"尚无执行证据，无法确认功能正确性。"}
	} else if !e.Execution.CompileOK {
		e.Summary = "沙箱编译失败，功能项已按测试规则评分。"
		e.Issues = []string{"沙箱编译失败，请查看编译错误并修正代码。"}
	} else {
		e.Summary = fmt.Sprintf("沙箱测试通过 %d/%d，功能项已按测试权重评分。", e.Execution.Passed, e.Execution.Total)
		e.Issues = []string{}
		if e.Execution.Passed < e.Execution.Total {
			e.Issues = append(e.Issues, "部分测试未通过，请结合运行结果检查实现。")
		}
	}
	if e.Incomplete && e.Execution != nil {
		e.Summary += "仍有未评分项，教师复核前不计入总成绩。"
	}
	e.Improvements = []string{"结合测试结果和评分量规改进代码；未评分项由教师复核。"}
	e.EvidenceType = "static"
	if e.Execution != nil {
		e.EvidenceType = "execution_and_static"
	}
}

// FinalScores returns only complete grades, preferring a published human review.
func FinalScores(s Submission) (int, []HumanScore, bool) {
	if s.Status != "graded" && s.Status != "needs_review" {
		return 0, nil, false
	}
	if s.Review != nil {
		return s.Review.Total, s.Review.Dimensions, true
	}
	e := s.Evaluation
	if e == nil || e.Incomplete || len(e.Dimensions) == 0 {
		return 0, nil, false
	}
	dimensions := make([]HumanScore, 0, len(e.Dimensions))
	for _, d := range e.Dimensions {
		if d.Unscored {
			return 0, nil, false
		}
		dimensions = append(dimensions, HumanScore{Key: d.Key, Name: d.Name, Score: d.Score, MaxScore: d.MaxScore})
	}
	return e.Total, dimensions, true
}
