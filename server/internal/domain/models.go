package domain

import "time"

type RubricItem struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Weight      int    `json:"weight"`
}
type Assignment struct {
	ID                   string       `json:"id"`
	TeacherID            string       `json:"teacherId"`
	TeacherName          string       `json:"teacherName"`
	Title                string       `json:"title"`
	Status               string       `json:"status"`
	MaxSubmissions       int          `json:"maxSubmissions"`
	Language             string       `json:"language"`
	Description          string       `json:"description"`
	DueAt                time.Time    `json:"dueAt"`
	Rubric               []RubricItem `json:"rubric"`
	LLMEvaluationEnabled bool         `json:"llmEvaluationEnabled"`
	ReferenceSolution    string       `json:"-"`
	KnowledgeBase        string       `json:"-"`
	HasReferenceMaterial bool         `json:"hasReferenceMaterial"`
}
type AnalysisFinding struct {
	Category    string `json:"category"`
	Severity    string `json:"severity"`
	Location    string `json:"location"`
	Evidence    string `json:"evidence"`
	Explanation string `json:"explanation"`
}
type DimensionScore struct {
	Key          string  `json:"key"`
	Name         string  `json:"name"`
	Criterion    string  `json:"criterion"`
	Score        int     `json:"score"`
	MaxScore     int     `json:"maxScore"`
	Evidence     string  `json:"evidence"`
	Suggestion   string  `json:"suggestion"`
	Confidence   float64 `json:"confidence"`
	Verified     bool    `json:"verified"`
	EvidenceType string  `json:"evidenceType"`
}
type Evaluation struct {
	Total            int               `json:"total"`
	MaxTotal         int               `json:"maxTotal"`
	Status           string            `json:"status"`
	Summary          string            `json:"summary"`
	Strengths        []string          `json:"strengths"`
	Issues           []string          `json:"issues"`
	Improvements     []string          `json:"improvements"`
	Dimensions       []DimensionScore  `json:"dimensions"`
	ReviewedAt       time.Time         `json:"reviewedAt"`
	Provider         string            `json:"provider"`
	Model            string            `json:"model,omitempty"`
	Confidence       float64           `json:"confidence"`
	Verified         bool              `json:"verified"`
	EvidenceType     string            `json:"evidenceType"`
	Analysis         []AnalysisFinding `json:"analysis"`
	PromptVersion    string            `json:"promptVersion"`
	EvaluatorVersion string            `json:"evaluatorVersion"`
	ModelCalls       int               `json:"modelCalls"`
}
type Submission struct {
	ID           string      `json:"id"`
	AssignmentID string      `json:"assignmentId"`
	StudentName  string      `json:"studentName"`
	Code         string      `json:"code"`
	Status       string      `json:"status"`
	Progress     int         `json:"progress"`
	SubmittedAt  time.Time   `json:"submittedAt"`
	Evaluation   *Evaluation `json:"evaluation,omitempty"`
}
