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
}
type DimensionScore struct {
	Key        string `json:"key"`
	Name       string `json:"name"`
	Score      int    `json:"score"`
	MaxScore   int    `json:"maxScore"`
	Evidence   string `json:"evidence"`
	Suggestion string `json:"suggestion"`
}
type Evaluation struct {
	Total      int              `json:"total"`
	MaxTotal   int              `json:"maxTotal"`
	Status     string           `json:"status"`
	Summary    string           `json:"summary"`
	Dimensions []DimensionScore `json:"dimensions"`
	ReviewedAt time.Time        `json:"reviewedAt"`
	Provider   string           `json:"provider"`
	Model      string           `json:"model,omitempty"`
}
type Submission struct {
	ID           string      `json:"id"`
	AssignmentID string      `json:"assignmentId"`
	StudentName  string      `json:"studentName"`
	Code         string      `json:"code"`
	Status       string      `json:"status"`
	SubmittedAt  time.Time   `json:"submittedAt"`
	Evaluation   *Evaluation `json:"evaluation,omitempty"`
}
