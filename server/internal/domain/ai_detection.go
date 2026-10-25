package domain

import "time"

// AIRate is a model estimate of AI authorship, not a measured fraction of code.
type AIDetection struct {
	SubmissionID string       `json:"submissionId"`
	Status       string       `json:"status"`
	AIRate       *float64     `json:"aiRate"`
	Confidence   float64      `json:"confidence"`
	Summary      string       `json:"summary"`
	Evidence     []AIEvidence `json:"evidence"`
	Limitations  []string     `json:"limitations"`
	Model        string       `json:"model"`
	ModelCalls   int          `json:"modelCalls"`
	GeneratedAt  time.Time    `json:"generatedAt"`
}

type AIEvidence struct {
	StartLine   int    `json:"startLine"`
	EndLine     int    `json:"endLine"`
	Quote       string `json:"quote"`
	Explanation string `json:"explanation"`
}
