package domain

import "testing"

func TestLegacyRulePlaceholdersAreNeverFinalGrades(t *testing.T) {
	e := Evaluation{Provider: "rules", Total: 75, MaxTotal: 100, Status: "needs_review", Verified: true,
		Execution: &ExecutionEvidence{CompileOK: true, Passed: 2, Total: 2, PassedWeight: 2, TotalWeight: 2},
		Dimensions: []DimensionScore{
			{Key: "correctness", Score: 50, MaxScore: 50, EvidenceType: "execution", Verified: true},
			{Key: "quality", Score: 25, MaxScore: 50, EvidenceType: "static"},
		}}
	NormalizeLegacyEvaluation(&e)
	if e.Total != 50 || !e.Incomplete || e.Verified || !e.Dimensions[1].Unscored || e.Dimensions[1].Score != 0 {
		t.Fatalf("placeholder still counted: %+v", e)
	}
	sub := Submission{Status: "needs_review", Evaluation: &e}
	if _, _, complete := FinalScores(sub); complete {
		t.Fatal("partial evaluation must not enter grade statistics")
	}
	sub.Status = "graded"
	sub.Review = &Review{Total: 84, Dimensions: []HumanScore{{Key: "correctness", Score: 50, MaxScore: 50}, {Key: "quality", Score: 34, MaxScore: 50}}}
	if total, _, complete := FinalScores(sub); !complete || total != 84 {
		t.Fatalf("published review not used: %d, %v", total, complete)
	}
	if e.Total != 50 || !e.Incomplete {
		t.Fatal("review altered original evaluation")
	}
}

func TestRuleExecutionOnlyRubricCanBeComplete(t *testing.T) {
	e := Evaluation{Provider: "rules", Execution: &ExecutionEvidence{CompileOK: true, Total: 1, TotalWeight: 1}, Dimensions: []DimensionScore{{Key: "correctness", Score: 0, MaxScore: 100, EvidenceType: "execution", Verified: true}}}
	NormalizeLegacyEvaluation(&e)
	if e.Incomplete || e.Status != "graded" || e.Dimensions[0].Unscored {
		t.Fatalf("a tested zero is a valid grade: %+v", e)
	}
	if score, _, complete := FinalScores(Submission{Status: "graded", Evaluation: &e}); !complete || score != 0 {
		t.Fatal("zero score was confused with missing score")
	}
	e.Execution.TotalWeight = 0
	NormalizeLegacyEvaluation(&e)
	if !e.Incomplete || !e.Dimensions[0].Unscored {
		t.Fatal("empty test suite incorrectly verified a score")
	}
}

func TestFinalScoresExcludesPendingAndMissingDimensions(t *testing.T) {
	for _, status := range []string{"queued", "evaluating", "failed"} {
		if _, _, ok := FinalScores(Submission{Status: status, Review: &Review{Total: 90}}); ok {
			t.Fatalf("%s included in statistics", status)
		}
	}
	if _, _, ok := FinalScores(Submission{Status: "graded", Evaluation: &Evaluation{Total: 0}}); ok {
		t.Fatal("empty evaluation included in statistics")
	}
}
