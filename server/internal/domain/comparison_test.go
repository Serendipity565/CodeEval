package domain

import (
	"encoding/json"
	"math"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestComparisonLatestSubmissionChosenBeforeEligibility(t *testing.T) {
	old := comparisonTestSubmission("1", "student-a", 80, 100)
	pending := comparisonTestSubmission("2", "student-a", 90, 100)
	pending.SubmittedAt = old.SubmittedAt.Add(time.Minute)
	pending.Status = "queued"
	pending.Evaluation = nil
	// IDs must compare numerically: 10 is newer than 9 at the same timestamp.
	lowID := comparisonTestSubmission("9", "student-b", 20, 100)
	highID := comparisonTestSubmission("10", "student-b", 70, 100)
	otherAssignment := comparisonTestSubmission("11", "student-c", 60, 100)
	otherAssignment.AssignmentID = "other"
	unknownStudent := comparisonTestSubmission("12", "", 70, 100)
	submissions := []Submission{highID, pending, lowID, otherAssignment, old, unknownStudent}
	ratings := map[string][]ExpertRating{
		"1":  {comparisonTestRating("1", "Expert", 80, 100)},
		"9":  {comparisonTestRating("2", "Expert", 20, 100)},
		"10": {comparisonTestRating("3", "Expert", 70, 100)},
		"11": {comparisonTestRating("4", "Expert", 60, 100)},
		"12": {comparisonTestRating("5", "Expert", 70, 100)},
	}
	result := BuildComparison("assignment", submissions, ratings)
	if result.LatestSubmissionCount != 2 || result.PairedCount != 1 || result.ExcludedCount != 1 {
		t.Fatalf("incorrect latest counts: %+v", result)
	}
	if result.Selection != "latest_per_student" || result.Pairs[0].SubmissionID != "10" {
		t.Fatalf("incorrect latest selection: %+v", result)
	}
	for i, j := 0, len(submissions)-1; i < j; i, j = i+1, j-1 {
		submissions[i], submissions[j] = submissions[j], submissions[i]
	}
	if reversed := BuildComparison("assignment", submissions, ratings); !reflect.DeepEqual(reversed, result) {
		t.Fatalf("input order changed comparison: got %+v, want %+v", reversed, result)
	}
}

func TestComparisonSampleWeightingAndHandCalculatedMetrics(t *testing.T) {
	first := comparisonTestSubmission("1", "a", 80, 100)
	first.Evaluation.DurationMS = 1500
	second := comparisonTestSubmission("2", "b", 60, 100)
	second.Evaluation.DurationMS = 2500
	firstA := comparisonTestRating("1", "Expert A", 80, 100)
	firstA.DurationSeconds = 40
	firstB := comparisonTestRating("2", "Expert B", 90, 100)
	firstB.DurationSeconds = 60
	secondA := comparisonTestRating("3", "Expert A", 40, 100)
	secondA.DurationSeconds = 10
	result := BuildComparison("assignment", []Submission{second, first}, map[string][]ExpertRating{
		"1": {firstA, firstB},
		"2": {secondA},
	})
	if result.PairedCount != 2 || result.Metrics == nil {
		t.Fatalf("expected two paired samples: %+v", result)
	}
	m := result.Metrics
	// Per-student expert means are 85 and 40. Averaging all three individual
	// ratings would incorrectly produce 70 instead of the expected 62.5.
	for name, values := range map[string][2]float64{
		"ai mean":          {m.AIMean, 70},
		"expert mean":      {m.ExpertMean, 62.5},
		"AI population SD": {m.AIStdDev, 10},
		"expert SD":        {m.ExpertStdDev, 22.5},
		"MAE":              {m.MeanAbsoluteError, 12.5},
		"RMSE":             {m.RootMeanSquaredError, math.Sqrt(212.5)},
		"bias":             {m.MeanBias, 7.5},
		"within five":      {m.WithinFivePointsRate, 0.5},
	} {
		comparisonAssertNear(t, name, values[0], values[1])
	}
	if m.AITimedCount != 2 || m.ExpertTimedCount != 2 || m.AIMeanDurationSeconds == nil || m.ExpertMeanDurationSeconds == nil {
		t.Fatalf("missing timed sample counts: %+v", m)
	}
	comparisonAssertNear(t, "AI seconds", *m.AIMeanDurationSeconds, 2)
	comparisonAssertNear(t, "expert seconds", *m.ExpertMeanDurationSeconds, 30)
	if result.Pairs[0].ExpertCount != 2 || result.Pairs[1].ExpertCount != 1 {
		t.Fatalf("incorrect expert counts: %+v", result.Pairs)
	}
	if dimension := result.Pairs[0].Dimensions[1]; dimension.MaxScore != 40 || dimension.AIScore != 20 || dimension.ExpertMean != 25 || dimension.Difference != -5 {
		t.Fatalf("incorrect dimension result: %+v", dimension)
	}
}

func TestComparisonIndependentExpertNamesDeduplicateLatest(t *testing.T) {
	submission := comparisonTestSubmission("1", "a", 80, 100)
	old := comparisonTestRating("1", "  Expert   A ", 0, 100)
	latestLowID := comparisonTestRating("9", "EXPERT\tA", 20, 100)
	latestLowID.CreatedAt = old.CreatedAt.Add(time.Minute)
	latestHighID := comparisonTestRating("10", "ｅｘｐｅｒｔ ａ", 90, 100)
	latestHighID.CreatedAt = latestLowID.CreatedAt
	blank := comparisonTestRating("11", "\t \n", 0, 100)
	other := comparisonTestRating("12", "Expert B", 70, 100)
	result := BuildComparison("assignment", []Submission{submission}, map[string][]ExpertRating{
		"1": {latestHighID, blank, old, other, latestLowID},
	})
	if result.PairedCount != 1 || result.Pairs[0].ExpertCount != 2 || result.Pairs[0].ExpertMean != 80 {
		t.Fatalf("expected one vote per independent expert using their latest rating: %+v", result)
	}
}

func TestComparisonNormalizesTotalsAndIgnoresTeacherReview(t *testing.T) {
	submission := comparisonTestSubmission("1", "a", 100, 200)
	submission.Review = &Review{Total: 200, MaxTotal: 200}
	rating := comparisonTestRating("1", "Expert", 160, 200)
	// Experts may supply rubric items in any order.
	rating.Dimensions[0], rating.Dimensions[1] = rating.Dimensions[1], rating.Dimensions[0]
	result := BuildComparison("assignment", []Submission{submission}, map[string][]ExpertRating{"1": {rating}})
	if result.PairedCount != 1 {
		t.Fatalf("expected a valid pair: %+v", result)
	}
	pair := result.Pairs[0]
	if pair.AITotal != 50 || pair.ExpertMean != 80 || pair.Difference != -30 {
		t.Fatalf("totals must normalize original AI grades to 100: %+v", pair)
	}
	if dimension := pair.Dimensions[0]; dimension.MaxScore != 120 || dimension.AIScore != 100 || dimension.ExpertMean != 120 || dimension.Difference != -20 {
		t.Fatalf("dimensions should preserve raw rubric points: %+v", dimension)
	}
	if submission.Evaluation.Total != 100 || rating.Dimensions[0].Key != "quality" {
		t.Fatal("comparison mutated source evaluation or expert rubric")
	}
}

func TestComparisonExcludesIncompleteAndIncompatibleSamples(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*Submission, *ExpertRating)
	}{
		{"failed status", func(s *Submission, _ *ExpertRating) { s.Status = "failed" }},
		{"pending status", func(s *Submission, _ *ExpertRating) { s.Status = "running" }},
		{"missing evaluation", func(s *Submission, _ *ExpertRating) { s.Evaluation = nil }},
		{"rules placeholder", func(s *Submission, _ *ExpertRating) { s.Evaluation.Provider = "rules" }},
		{"unknown provider", func(s *Submission, _ *ExpertRating) { s.Evaluation.Provider = "" }},
		{"incomplete evaluation", func(s *Submission, _ *ExpertRating) { s.Evaluation.Incomplete = true }},
		{"unscored dimension", func(s *Submission, _ *ExpertRating) { s.Evaluation.Dimensions[1].Unscored = true }},
		{"zero maximum", func(s *Submission, _ *ExpertRating) { s.Evaluation.MaxTotal = 0 }},
		{"missing AI dimensions", func(s *Submission, _ *ExpertRating) { s.Evaluation.Dimensions = nil }},
		{"AI total inconsistent", func(s *Submission, _ *ExpertRating) { s.Evaluation.Total++ }},
		{"AI maximum inconsistent", func(s *Submission, _ *ExpertRating) { s.Evaluation.MaxTotal++ }},
		{"AI score out of range", func(s *Submission, _ *ExpertRating) { s.Evaluation.Dimensions[0].Score = 61 }},
		{"AI duplicate dimensions", func(s *Submission, _ *ExpertRating) { s.Evaluation.Dimensions[1].Key = "correctness" }},
		{"expert total inconsistent", func(_ *Submission, r *ExpertRating) { r.Total++ }},
		{"expert total out of range", func(_ *Submission, r *ExpertRating) { r.Total = 101 }},
		{"expert maximum mismatch", func(_ *Submission, r *ExpertRating) { r.MaxTotal++ }},
		{"expert missing dimension", func(_ *Submission, r *ExpertRating) { r.Dimensions = r.Dimensions[:1] }},
		{"expert renamed key", func(_ *Submission, r *ExpertRating) { r.Dimensions[0].Key = "new" }},
		{"expert duplicate dimension", func(_ *Submission, r *ExpertRating) { r.Dimensions[1].Key = "correctness" }},
		{"expert maximum changed", func(_ *Submission, r *ExpertRating) {
			r.Dimensions[0].MaxScore++
			r.Dimensions[1].MaxScore--
		}},
		{"expert score negative", func(_ *Submission, r *ExpertRating) { r.Dimensions[1].Score = -1 }},
		{"expert score too high", func(_ *Submission, r *ExpertRating) { r.Dimensions[1].Score = 41 }},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			submission := comparisonTestSubmission("1", "a", 80, 100)
			rating := comparisonTestRating("1", "Expert", 80, 100)
			tc.mutate(&submission, &rating)
			result := BuildComparison("assignment", []Submission{submission}, map[string][]ExpertRating{"1": {rating}})
			if result.Metrics != nil || result.PairedCount != 0 || result.ExcludedCount != 1 {
				t.Fatalf("invalid sample entered comparison: %+v", result)
			}
		})
	}
	// A pending human review is still a complete original AI assessment.
	submission := comparisonTestSubmission("1", "a", 80, 100)
	submission.Status = "needs_review"
	result := BuildComparison("assignment", []Submission{submission}, map[string][]ExpertRating{"1": {comparisonTestRating("1", "Expert", 80, 100)}})
	if result.PairedCount != 1 {
		t.Fatal("complete needs_review AI evaluation should remain eligible")
	}
}

func TestComparisonLatestExpertWithChangedRubricDoesNotFallback(t *testing.T) {
	submission := comparisonTestSubmission("1", "a", 80, 100)
	old := comparisonTestRating("1", "Expert", 80, 100)
	latest := comparisonTestRating("2", "EXPERT", 80, 100)
	latest.CreatedAt = old.CreatedAt.Add(time.Minute)
	latest.Dimensions[0].MaxScore = 70
	latest.Dimensions[1].MaxScore = 30
	result := BuildComparison("assignment", []Submission{submission}, map[string][]ExpertRating{"1": {latest, old}})
	if result.PairedCount != 0 || result.ExcludedCount != 1 {
		t.Fatalf("obsolete expert rating must not be reused: %+v", result)
	}
}

func TestComparisonMissingDurationsAndEmptyJSON(t *testing.T) {
	empty := BuildComparison("assignment", nil, nil)
	encoded, err := json.Marshal(empty)
	if err != nil || !strings.Contains(string(encoded), `"metrics":null`) || !strings.Contains(string(encoded), `"pairs":[]`) {
		t.Fatalf("empty comparison must serialize without NaN or null pair list: %s, %v", encoded, err)
	}
	submission := comparisonTestSubmission("1", "a", 0, 100)
	submission.Evaluation.DurationMS = -1
	missing := comparisonTestRating("1", "Expert A", 0, 100)
	missing.DurationSeconds = -1
	result := BuildComparison("assignment", []Submission{submission}, map[string][]ExpertRating{"1": {missing}})
	if result.PairedCount != 1 || result.Metrics.AITimedCount != 0 || result.Metrics.ExpertTimedCount != 0 || result.Metrics.AIMeanDurationSeconds != nil || result.Metrics.ExpertMeanDurationSeconds != nil {
		t.Fatalf("unmeasured durations must not become zeros: %+v", result)
	}
	if result.Pairs[0].AIDurationSeconds != nil || result.Pairs[0].ExpertDurationSeconds != nil || result.Metrics.WithinFivePointsRate != 1 || result.Metrics.AIStdDev != 0 {
		t.Fatalf("zero-score single sample should remain finite and untimed: %+v", result)
	}
	if _, err := json.Marshal(result); err != nil {
		t.Fatalf("single-sample metrics contain non-finite numbers: %v", err)
	}
	measured := comparisonTestRating("2", "Expert B", 0, 100)
	measured.DurationSeconds = 30
	result = BuildComparison("assignment", []Submission{submission}, map[string][]ExpertRating{"1": {missing, measured}})
	if result.Metrics.ExpertTimedCount != 1 || result.Metrics.ExpertMeanDurationSeconds == nil || *result.Metrics.ExpertMeanDurationSeconds != 30 {
		t.Fatalf("unmeasured expert must not dilute recorded timing: %+v", result.Metrics)
	}
	withoutExperts := BuildComparison("assignment", []Submission{submission}, nil)
	if withoutExperts.PairedCount != 0 || withoutExperts.Metrics != nil || withoutExperts.ExcludedCount != 1 {
		t.Fatalf("unpaired AI sample must not affect metrics: %+v", withoutExperts)
	}
}

func comparisonTestSubmission(id, student string, total, maximum int) Submission {
	scores := comparisonTestDimensions(total, maximum)
	return Submission{
		ID: id, StudentID: student, StudentName: "Student " + student,
		AssignmentID: "assignment", Status: "graded",
		SubmittedAt: time.Date(2026, 10, 11, 1, 0, 0, 0, time.UTC),
		Evaluation: &Evaluation{
			Provider: "deepseek-agent", Status: "graded", Total: total, MaxTotal: maximum,
			Dimensions: []DimensionScore{
				{Key: scores[0].Key, Name: scores[0].Name, Score: scores[0].Score, MaxScore: scores[0].MaxScore},
				{Key: scores[1].Key, Name: scores[1].Name, Score: scores[1].Score, MaxScore: scores[1].MaxScore},
			},
		},
	}
}

func comparisonTestRating(id, expert string, total, maximum int) ExpertRating {
	return ExpertRating{
		ID: id, ExpertName: expert, Total: total, MaxTotal: maximum,
		Dimensions: comparisonTestDimensions(total, maximum),
		CreatedAt:  time.Date(2026, 10, 11, 2, 0, 0, 0, time.UTC),
	}
}

func comparisonTestDimensions(total, maximum int) []HumanScore {
	firstMax := maximum * 3 / 5
	firstScore := min(total, firstMax)
	return []HumanScore{
		{Key: "correctness", Name: "Correctness", Score: firstScore, MaxScore: firstMax},
		{Key: "quality", Name: "Quality", Score: total - firstScore, MaxScore: maximum - firstMax},
	}
}

func comparisonAssertNear(t *testing.T, label string, got, want float64) {
	t.Helper()
	if math.IsNaN(got) || math.IsInf(got, 0) || math.Abs(got-want) > 1e-9 {
		t.Errorf("%s: got %v, want %v", label, got, want)
	}
}
