package domain

import "time"

// AIRate is a rule-aggregated tendency score, not a calibrated probability or
// measured fraction of code. Reports without ScoringVersion are legacy estimates.
type AIDetection struct {
	SubmissionID            string              `json:"submissionId"`
	Status                  string              `json:"status"`
	AIRate                  *float64            `json:"aiRate"`
	Confidence              float64             `json:"confidence"`
	Summary                 string              `json:"summary"`
	Evidence                []AIEvidence        `json:"evidence"`
	Limitations             []string            `json:"limitations"`
	Checks                  []string            `json:"checks,omitempty"`
	Execution               *ExecutionEvidence  `json:"execution,omitempty"`
	Model                   string              `json:"model"`
	ModelCalls              int                 `json:"modelCalls"`
	GeneratedAt             time.Time           `json:"generatedAt"`
	ScoringVersion          string              `json:"scoringVersion,omitempty"`
	RecalculatedFromVersion string              `json:"recalculatedFromVersion,omitempty"`
	Dimensions              []AIDimension       `json:"dimensions,omitempty"`
	Coverage                float64             `json:"coverage,omitempty"`
	AggregationNotes        []string            `json:"aggregationNotes,omitempty"`
	SampleComparison        *AISampleComparison `json:"sampleComparison,omitempty"`
	CitationVersion         string              `json:"citationVersion,omitempty"`
	CitationDiagnostics     []string            `json:"citationDiagnostics,omitempty"`
}

// Score is the model's ordinal assessment; EffectiveScore and Included are
// assigned by the server after verifying source evidence. New rules retain each
// assessed dimension regardless of strength or shared source ranges.
type AIDimension struct {
	Key             string       `json:"key"`
	Label           string       `json:"label"`
	Weight          int          `json:"weight"`
	Status          string       `json:"status"`
	Score           *int         `json:"score"`
	EffectiveScore  *int         `json:"effectiveScore"`
	Strength        string       `json:"strength"`
	Reason          string       `json:"reason"`
	Alternative     string       `json:"alternative"`
	Evidence        []AIEvidence `json:"evidence"`
	Included        bool         `json:"included"`
	ExclusionReason string       `json:"exclusionReason,omitempty"`
	EvidenceBasis   string       `json:"evidenceBasis,omitempty"`
}

// AIDetectionContext contains records for this immutable submission and only
// earlier attempts by the same student in the same assignment.
type AIDetectionContext struct {
	Execution  *ExecutionEvidence
	History    []Submission
	SampleBank *AISampleBank
}

type AISample struct {
	ID       string `json:"id"`
	Approach string `json:"approach"`
	Code     string `json:"code"`
}

type AISampleBank struct {
	Fingerprint string     `json:"fingerprint"`
	Model       string     `json:"model"`
	GeneratedAt time.Time  `json:"generatedAt"`
	Samples     []AISample `json:"samples"`
}

type AISampleMatch struct {
	ID       string         `json:"id"`
	Approach string         `json:"approach"`
	Code     string         `json:"code,omitempty"`
	Pair     SimilarityPair `json:"pair"`
}

type AISampleComparison struct {
	Status      string          `json:"status"`
	Fingerprint string          `json:"fingerprint,omitempty"`
	GeneratedAt time.Time       `json:"generatedAt,omitempty"`
	Samples     []AISampleMatch `json:"samples"`
	Note        string          `json:"note"`
}

type AIEvidence struct {
	CitationID       string `json:"citationId,omitempty"`
	MatchID          string `json:"matchId,omitempty"`
	StartLine        int    `json:"startLine"`
	EndLine          int    `json:"endLine"`
	Quote            string `json:"quote"`
	Explanation      string `json:"explanation"`
	Counted          bool   `json:"counted,omitempty"`
	SourceID         string `json:"sourceId,omitempty"`
	SourceCitationID string `json:"sourceCitationId,omitempty"`
	SourceStartLine  int    `json:"sourceStartLine,omitempty"`
	SourceEndLine    int    `json:"sourceEndLine,omitempty"`
	SourceQuote      string `json:"sourceQuote,omitempty"`
}
