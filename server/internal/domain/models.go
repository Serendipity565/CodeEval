package domain

import "time"

type RubricItem struct {
	Key         string `json:"key"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Weight      int    `json:"weight"`
}
type TestCase struct {
	Name      string `json:"name"`
	Input     string `json:"input"`
	Expected  string `json:"expected"`
	Hidden    bool   `json:"hidden"`
	Weight    int    `json:"weight"`
	TimeoutMS int    `json:"timeoutMs"`
}
type TestResult struct {
	Name       string `json:"name"`
	Passed     bool   `json:"passed"`
	Hidden     bool   `json:"hidden"`
	Input      string `json:"input,omitempty"`
	Expected   string `json:"expected,omitempty"`
	Actual     string `json:"actual,omitempty"`
	ExitCode   int    `json:"exitCode"`
	DurationMS int64  `json:"durationMs"`
	Error      string `json:"error,omitempty"`
}
type ExecutionEvidence struct {
	Language     string       `json:"language"`
	CompileOK    bool         `json:"compileOk"`
	CompileError string       `json:"compileError,omitempty"`
	Passed       int          `json:"passed"`
	Total        int          `json:"total"`
	PassedWeight int          `json:"passedWeight"`
	TotalWeight  int          `json:"totalWeight"`
	Results      []TestResult `json:"results"`
}
type Course struct {
	ID              string `json:"id"`
	TeacherID       string `json:"teacherId"`
	TeacherName     string `json:"teacherName"`
	Title           string `json:"title"`
	Description     string `json:"description"`
	StudentCount    int64  `json:"studentCount"`
	AssignmentCount int64  `json:"assignmentCount"`
	Enrolled        bool   `json:"enrolled"`
}
type CourseStudent struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Username   string    `json:"username"`
	EnrolledAt time.Time `json:"enrolledAt"`
}
type AssignmentStudent struct {
	ID              string     `json:"id"`
	Name            string     `json:"name"`
	Username        string     `json:"username"`
	SubmissionCount int64      `json:"submissionCount"`
	SubmissionID    string     `json:"submissionId,omitempty"`
	SubmittedAt     *time.Time `json:"submittedAt,omitempty"`
}
type Assignment struct {
	CourseID          string   `json:"courseId"`
	CourseTitle       string   `json:"courseTitle"`
	ExpectedStudents  int64    `json:"expectedStudents"`
	SubmittedStudents int64    `json:"submittedStudents"`
	SubmissionRate    *float64 `json:"submissionRate"`

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
	TestCases            []TestCase   `json:"-"`
	PublicTestCases      []TestCase   `json:"testCases"`
	HasHiddenTests       bool         `json:"hasHiddenTests"`
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
	Unscored     bool    `json:"unscored"`
	MaxScore     int     `json:"maxScore"`
	Evidence     string  `json:"evidence"`
	Suggestion   string  `json:"suggestion"`
	Confidence   float64 `json:"confidence"`
	Verified     bool    `json:"verified"`
	EvidenceType string  `json:"evidenceType"`
}
type Evaluation struct {
	Total            int                `json:"total"`
	Incomplete       bool               `json:"incomplete"`
	DurationMS       int64              `json:"durationMs,omitempty"`
	MaxTotal         int                `json:"maxTotal"`
	Status           string             `json:"status"`
	Summary          string             `json:"summary"`
	Strengths        []string           `json:"strengths"`
	Issues           []string           `json:"issues"`
	Improvements     []string           `json:"improvements"`
	Dimensions       []DimensionScore   `json:"dimensions"`
	ReviewedAt       time.Time          `json:"reviewedAt"`
	Provider         string             `json:"provider"`
	Model            string             `json:"model,omitempty"`
	Confidence       float64            `json:"confidence"`
	Verified         bool               `json:"verified"`
	EvidenceType     string             `json:"evidenceType"`
	Analysis         []AnalysisFinding  `json:"analysis"`
	PromptVersion    string             `json:"promptVersion"`
	EvaluatorVersion string             `json:"evaluatorVersion"`
	ModelCalls       int                `json:"modelCalls"`
	ContextSources   []string           `json:"contextSources,omitempty"`
	Execution        *ExecutionEvidence `json:"execution,omitempty"`
}
type Submission struct {
	ID           string      `json:"id"`
	AssignmentID string      `json:"assignmentId"`
	StudentName  string      `json:"studentName"`
	StudentID    string      `json:"studentId"`
	Code         string      `json:"code"`
	Status       string      `json:"status"`
	Progress     int         `json:"progress"`
	SubmittedAt  time.Time   `json:"submittedAt"`
	Evaluation   *Evaluation `json:"evaluation,omitempty"`
	Review       *Review     `json:"review,omitempty"`
}
