package protocol

type TestCase struct {
	Name      string `json:"name"`
	Input     string `json:"input"`
	Expected  string `json:"expected"`
	Hidden    bool   `json:"hidden"`
	Weight    int    `json:"weight"`
	TimeoutMS int    `json:"timeoutMs"`
}
type Request struct {
	Language string     `json:"language"`
	Code     string     `json:"code"`
	Tests    []TestCase `json:"tests"`
}
type TestResult struct {
	Name       string `json:"name"`
	Passed     bool   `json:"passed"`
	Actual     string `json:"actual,omitempty"`
	ExitCode   int    `json:"exitCode"`
	DurationMS int64  `json:"durationMs"`
	Error      string `json:"error,omitempty"`
}
type Response struct {
	Language     string       `json:"language"`
	CompileOK    bool         `json:"compileOk"`
	CompileError string       `json:"compileError,omitempty"`
	Passed       int          `json:"passed"`
	Total        int          `json:"total"`
	PassedWeight int          `json:"passedWeight"`
	TotalWeight  int          `json:"totalWeight"`
	Results      []TestResult `json:"results"`
}
