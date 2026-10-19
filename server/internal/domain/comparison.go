package domain

import (
	"math"
	"math/big"
	"sort"
	"strings"
	"time"

	"golang.org/x/text/unicode/norm"
)

// Comparison uses the latest submission per student, whether or not it can be
// paired. In particular, a pending resubmission never falls back to an old grade.
type Comparison struct {
	AssignmentID          string             `json:"assignmentId"`
	Selection             string             `json:"selection"`
	LatestSubmissionCount int                `json:"latestSubmissionCount"`
	PairedCount           int                `json:"pairedCount"`
	ExcludedCount         int                `json:"excludedCount"`
	Metrics               *ComparisonMetrics `json:"metrics"`
	Pairs                 []ComparisonPair   `json:"pairs"`
}

type ComparisonMetrics struct {
	AIMean                    float64  `json:"aiMean"`
	ExpertMean                float64  `json:"expertMean"`
	AIStdDev                  float64  `json:"aiStdDev"`
	ExpertStdDev              float64  `json:"expertStdDev"`
	MeanAbsoluteError         float64  `json:"meanAbsoluteError"`
	RootMeanSquaredError      float64  `json:"rootMeanSquaredError"`
	MeanBias                  float64  `json:"meanBias"`
	WithinFivePointsRate      float64  `json:"withinFivePointsRate"`
	AIMeanDurationSeconds     *float64 `json:"aiMeanDurationSeconds"`
	ExpertMeanDurationSeconds *float64 `json:"expertMeanDurationSeconds"`
	AITimedCount              int      `json:"aiTimedCount"`
	ExpertTimedCount          int      `json:"expertTimedCount"`
}

type ComparisonPair struct {
	SubmissionID          string                `json:"submissionId"`
	StudentID             string                `json:"studentId"`
	StudentName           string                `json:"studentName"`
	AITotal               float64               `json:"aiTotal"`
	ExpertMean            float64               `json:"expertMean"`
	Difference            float64               `json:"difference"`
	ExpertCount           int                   `json:"expertCount"`
	AIDurationSeconds     *float64              `json:"aiDurationSeconds"`
	ExpertDurationSeconds *float64              `json:"expertDurationSeconds"`
	Dimensions            []ComparisonDimension `json:"dimensions"`
}

type ComparisonDimension struct {
	Key        string  `json:"key"`
	Name       string  `json:"name"`
	MaxScore   int     `json:"maxScore"`
	AIScore    int     `json:"aiScore"`
	ExpertMean float64 `json:"expertMean"`
	Difference float64 `json:"difference"`
}

// BuildComparison compares original complete AI grades with independent expert
// ratings. It deliberately does not read teacher reviews. Totals are on a
// 100-point scale, dimensions retain their rubric units, and differences are
// AI minus expert. Each student has equal weight regardless of expert count.
func BuildComparison(assignmentID string, submissions []Submission, ratings map[string][]ExpertRating) Comparison {
	out := Comparison{
		AssignmentID: assignmentID,
		Selection:    "latest_per_student",
		Pairs:        []ComparisonPair{},
	}
	latest := make(map[string]Submission)
	for _, submission := range submissions {
		if submission.AssignmentID != assignmentID || strings.TrimSpace(submission.StudentID) == "" {
			continue
		}
		identity := submission.StudentID
		previous, exists := latest[identity]
		if !exists || comparisonNewer(submission.SubmittedAt, submission.ID, previous.SubmittedAt, previous.ID) {
			latest[identity] = submission
		}
	}
	out.LatestSubmissionCount = len(latest)
	selected := make([]Submission, 0, len(latest))
	for _, submission := range latest {
		selected = append(selected, submission)
	}
	sort.Slice(selected, func(i, j int) bool {
		if selected[i].StudentID != selected[j].StudentID {
			return selected[i].StudentID < selected[j].StudentID
		}
		return comparisonIDCompare(selected[i].ID, selected[j].ID) < 0
	})
	for _, submission := range selected {
		if pair, ok := buildComparisonPair(submission, ratings[submission.ID]); ok {
			out.Pairs = append(out.Pairs, pair)
		}
	}
	out.PairedCount = len(out.Pairs)
	out.ExcludedCount = out.LatestSubmissionCount - out.PairedCount
	if out.PairedCount == 0 {
		return out
	}
	out.Metrics = summarizeComparison(out.Pairs)
	return out
}

func buildComparisonPair(submission Submission, ratings []ExpertRating) (ComparisonPair, bool) {
	evaluation := submission.Evaluation
	if (submission.Status != "graded" && submission.Status != "needs_review") || !completeComparisonEvaluation(evaluation) {
		return ComparisonPair{}, false
	}
	// Select a person's latest record before validation: an obsolete rubric
	// cannot be revived by falling back to an older, compatible rating.
	latestExperts := make(map[string]ExpertRating)
	for _, rating := range ratings {
		name := strings.ToLower(strings.Join(strings.Fields(norm.NFKC.String(rating.ExpertName)), " "))
		if name == "" {
			continue
		}
		previous, exists := latestExperts[name]
		if !exists || comparisonNewer(rating.CreatedAt, rating.ID, previous.CreatedAt, previous.ID) {
			latestExperts[name] = rating
		}
	}
	names := make([]string, 0, len(latestExperts))
	for name := range latestExperts {
		names = append(names, name)
	}
	sort.Strings(names)
	pair := ComparisonPair{
		SubmissionID: submission.ID,
		StudentID:    submission.StudentID,
		StudentName:  submission.StudentName,
		AITotal:      float64(evaluation.Total) / float64(evaluation.MaxTotal) * 100,
		Dimensions:   make([]ComparisonDimension, len(evaluation.Dimensions)),
	}
	if evaluation.DurationMS > 0 {
		duration := float64(evaluation.DurationMS) / 1000
		pair.AIDurationSeconds = &duration
	}
	expertDuration, timedExperts := 0.0, 0
	for _, name := range names {
		rating := latestExperts[name]
		scores, ok := compatibleComparisonRating(evaluation, rating)
		if !ok {
			continue
		}
		pair.ExpertCount++
		pair.ExpertMean += float64(rating.Total) / float64(rating.MaxTotal) * 100
		for i, dimension := range evaluation.Dimensions {
			pair.Dimensions[i].ExpertMean += float64(scores[dimension.Key])
		}
		if rating.DurationSeconds > 0 {
			expertDuration += float64(rating.DurationSeconds)
			timedExperts++
		}
	}
	if pair.ExpertCount == 0 {
		return ComparisonPair{}, false
	}
	pair.ExpertMean /= float64(pair.ExpertCount)
	pair.Difference = pair.AITotal - pair.ExpertMean
	if timedExperts > 0 {
		duration := expertDuration / float64(timedExperts)
		pair.ExpertDurationSeconds = &duration
	}
	for i, dimension := range evaluation.Dimensions {
		item := &pair.Dimensions[i]
		item.Key = dimension.Key
		item.Name = dimension.Name
		item.MaxScore = dimension.MaxScore
		item.AIScore = dimension.Score
		item.ExpertMean /= float64(pair.ExpertCount)
		item.Difference = float64(dimension.Score) - item.ExpertMean
	}
	return pair, true
}

func completeComparisonEvaluation(evaluation *Evaluation) bool {
	if evaluation == nil || evaluation.Incomplete || evaluation.Provider != "deepseek-agent" || evaluation.MaxTotal <= 0 || len(evaluation.Dimensions) == 0 {
		return false
	}
	keys := make(map[string]bool, len(evaluation.Dimensions))
	total, maxTotal := 0, 0
	for _, dimension := range evaluation.Dimensions {
		if strings.TrimSpace(dimension.Key) == "" || keys[dimension.Key] || dimension.Unscored || dimension.MaxScore <= 0 || dimension.Score < 0 || dimension.Score > dimension.MaxScore {
			return false
		}
		keys[dimension.Key] = true
		// Compare to the remaining total to avoid integer overflow on bad data.
		if dimension.MaxScore > evaluation.MaxTotal-maxTotal || dimension.Score > evaluation.Total-total {
			return false
		}
		total += dimension.Score
		maxTotal += dimension.MaxScore
	}
	return total == evaluation.Total && maxTotal == evaluation.MaxTotal
}

func compatibleComparisonRating(evaluation *Evaluation, rating ExpertRating) (map[string]int, bool) {
	if rating.MaxTotal != evaluation.MaxTotal || rating.Total < 0 || rating.Total > rating.MaxTotal || len(rating.Dimensions) != len(evaluation.Dimensions) {
		return nil, false
	}
	aiDimensions := make(map[string]int, len(evaluation.Dimensions))
	for _, dimension := range evaluation.Dimensions {
		aiDimensions[dimension.Key] = dimension.MaxScore
	}
	scores := make(map[string]int, len(rating.Dimensions))
	total, maxTotal := 0, 0
	for _, dimension := range rating.Dimensions {
		maximum, exists := aiDimensions[dimension.Key]
		_, duplicate := scores[dimension.Key]
		if !exists || duplicate || dimension.MaxScore != maximum || dimension.Score < 0 || dimension.Score > maximum {
			return nil, false
		}
		if dimension.MaxScore > rating.MaxTotal-maxTotal || dimension.Score > rating.Total-total {
			return nil, false
		}
		scores[dimension.Key] = dimension.Score
		total += dimension.Score
		maxTotal += dimension.MaxScore
	}
	return scores, total == rating.Total && maxTotal == rating.MaxTotal
}

func summarizeComparison(pairs []ComparisonPair) *ComparisonMetrics {
	metrics := &ComparisonMetrics{}
	aiDuration, expertDuration := 0.0, 0.0
	for _, pair := range pairs {
		metrics.AIMean += pair.AITotal
		metrics.ExpertMean += pair.ExpertMean
		metrics.MeanAbsoluteError += math.Abs(pair.Difference)
		metrics.RootMeanSquaredError += pair.Difference * pair.Difference
		metrics.MeanBias += pair.Difference
		if math.Abs(pair.Difference) <= 5+1e-9 {
			metrics.WithinFivePointsRate++
		}
		if pair.AIDurationSeconds != nil {
			aiDuration += *pair.AIDurationSeconds
			metrics.AITimedCount++
		}
		if pair.ExpertDurationSeconds != nil {
			expertDuration += *pair.ExpertDurationSeconds
			metrics.ExpertTimedCount++
		}
	}
	count := float64(len(pairs))
	metrics.AIMean /= count
	metrics.ExpertMean /= count
	metrics.MeanAbsoluteError /= count
	metrics.RootMeanSquaredError = math.Sqrt(metrics.RootMeanSquaredError / count)
	metrics.MeanBias /= count
	metrics.WithinFivePointsRate /= count
	for _, pair := range pairs {
		metrics.AIStdDev += math.Pow(pair.AITotal-metrics.AIMean, 2)
		metrics.ExpertStdDev += math.Pow(pair.ExpertMean-metrics.ExpertMean, 2)
	}
	metrics.AIStdDev = math.Sqrt(metrics.AIStdDev / count)
	metrics.ExpertStdDev = math.Sqrt(metrics.ExpertStdDev / count)
	if metrics.AITimedCount > 0 {
		duration := aiDuration / float64(metrics.AITimedCount)
		metrics.AIMeanDurationSeconds = &duration
	}
	if metrics.ExpertTimedCount > 0 {
		duration := expertDuration / float64(metrics.ExpertTimedCount)
		metrics.ExpertMeanDurationSeconds = &duration
	}
	return metrics
}

func comparisonNewer(at time.Time, id string, previousAt time.Time, previousID string) bool {
	return at.After(previousAt) || (at.Equal(previousAt) && comparisonIDCompare(id, previousID) > 0)
}

func comparisonIDCompare(a, b string) int {
	left, leftOK := new(big.Int).SetString(a, 10)
	right, rightOK := new(big.Int).SetString(b, 10)
	if leftOK != rightOK {
		if leftOK {
			return -1
		}
		return 1
	}
	if leftOK && rightOK {
		if order := left.Cmp(right); order != 0 {
			return order
		}
	}
	return strings.Compare(a, b)
}
