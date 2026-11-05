package evaluator

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"codeeval/server/internal/domain"
	"codeeval/server/internal/sandbox"
)

func aiContextService(t *testing.T, inspect func(aiVerification)) *Service {
	t.Helper()
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		var request chatRequest
		if err := json.NewDecoder(req.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		var material struct {
			Verification aiVerification `json:"verification"`
		}
		if err := json.Unmarshal([]byte(request.Messages[1].Content), &material); err != nil {
			t.Fatal(err)
		}
		inspect(material.Verification)
		return jsonResponse(validAIResult), nil
	})
	return &Service{deepseek: client, maxCodeBytes: 200000}
}

type aiTestRunner struct {
	run func(string, string, []domain.TestCase) (*domain.ExecutionEvidence, error)
}

func (r aiTestRunner) Enabled() bool { return true }
func (r aiTestRunner) Run(_ context.Context, language, code string, tests []domain.TestCase) (*domain.ExecutionEvidence, error) {
	return r.run(language, code, tests)
}

func TestAIDetectionRunsConfiguredTestsAndProvidesReferenceAndPriorVersions(t *testing.T) {
	code := "value = 1\nprint(value)\nfor item in range(10):\n    value += item * 2\n    print(value, item)\nprint(value + 3)"
	runs := 0
	runner := aiTestRunner{run: func(language, input string, tests []domain.TestCase) (*domain.ExecutionEvidence, error) {
		runs++
		if input != code || len(tests) != 1 || language != "Python" {
			t.Fatalf("wrong sandbox input: %s %v", language, tests)
		}
		return &domain.ExecutionEvidence{CompileOK: true, Passed: 0, Total: 1, Results: []domain.TestResult{{Name: "边界用例", Passed: false, Actual: "2", Error: "output mismatch"}}}, nil
	}}
	service := aiContextService(t, func(v aiVerification) {
		if v.ExecutionSource != "sandbox_run" || v.Execution == nil || v.Execution.Total != 1 || v.Execution.Results[0].Actual != "2" {
			t.Fatalf("missing fresh execution: %+v", v)
		}
		if v.ReferenceStatus != "not_used" || v.Reference != nil {
			t.Fatalf("archive-only reference unexpectedly used: %+v", v)
		}
		if len(v.History) != 1 || len(v.History[0].Source) != 3 || v.History[0].Source[2].Line != 3 || v.History[0].Source[2].Code != "print(0)" {
			t.Fatalf("prior code lines lost: %+v", v.History)
		}
	})
	service.sandbox = runner
	assignment := domain.Assignment{Language: "Python", ReferenceSolution: code, TestCases: []domain.TestCase{{Name: "边界用例", Input: "1", Expected: "1"}}}
	result, err := service.DetectAICode(context.Background(), assignment, code, domain.AIDetectionContext{History: []domain.Submission{{ID: "3", Code: "\nvalue = 0\nprint(0)"}}})
	if err != nil || runs != 1 || result.Execution == nil || result.Execution.Results[0].Actual != "2" || !strings.Contains(strings.Join(result.Checks, "\n"), "测试通过 0/1") {
		t.Fatalf("execution checks missing from result: %+v runs=%d err=%v", result, runs, err)
	}
}

func TestAIDetectionReusesSavedExecutionAndDoesNotMutateOrLeakHiddenData(t *testing.T) {
	execution := &domain.ExecutionEvidence{CompileOK: true, Passed: 1, Total: 1, Results: []domain.TestResult{{Hidden: true, Input: "secret", Expected: "secret", Actual: "secret"}}}
	service := aiContextService(t, func(v aiVerification) {
		if v.ExecutionSource != "saved_evaluation" || v.Execution == nil || v.Execution.Passed != 1 || v.Execution.Results[0].Actual != "" || v.Execution.Results[0].Input != "" {
			t.Fatalf("saved or hidden evidence mishandled: %+v", v)
		}
	})
	// An invalid URL proves a saved result never reaches the runner.
	service.sandbox = sandbox.New(true, ":invalid", "", time.Second)
	result, err := service.DetectAICode(context.Background(), domain.Assignment{TestCases: []domain.TestCase{{}}}, "value = 1\nprint(value)", domain.AIDetectionContext{Execution: execution})
	if err != nil || !strings.Contains(strings.Join(result.Checks, "\n"), "复用本份提交") || execution.Results[0].Actual != "secret" {
		t.Fatalf("saved execution changed: %+v %v", result, err)
	}
}

func TestAIDetectionExplainsUnavailableExecutionAndContinues(t *testing.T) {
	for _, tc := range []struct {
		name, want string
		tests      []domain.TestCase
		runner     *sandbox.Client
	}{
		{"no tests", "未配置测试用例", nil, nil},
		{"disabled", "沙箱未启用", []domain.TestCase{{}}, sandbox.New(false, "", "", time.Second)},
		{"runner failure", "尝试沙箱执行失败", []domain.TestCase{{}}, sandbox.New(true, ":invalid", "", time.Second)},
	} {
		t.Run(tc.name, func(t *testing.T) {
			service := aiContextService(t, func(v aiVerification) {
				if v.Execution != nil || v.ExecutionSource != "unavailable" || !strings.Contains(strings.Join(v.Checks, "\n"), tc.want) {
					t.Fatalf("fabricated execution or wrong reason: %+v", v)
				}
			})
			service.sandbox = tc.runner
			if _, err := service.DetectAICode(context.Background(), domain.Assignment{TestCases: tc.tests}, "value = 1\nprint(value)"); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestAIVerificationBoundsHistoryExecutionAndUTF8(t *testing.T) {
	material := domain.AIDetectionContext{History: []domain.Submission{{ID: "1", Code: strings.Repeat("x", 20001)}, {ID: "2"}, {ID: "3"}, {ID: "4"}}}
	v := buildAIVerification(context.Background(), domain.Assignment{ReferenceSolution: strings.Repeat("x", 200001)}, "print(1)", material)
	if len(v.History) != 3 || !v.History[0].Omitted || len(v.History[0].Source) != 0 || v.ReferenceStatus != "not_used" {
		t.Fatalf("context limits not respected: %+v", v)
	}
	execution := &domain.ExecutionEvidence{CompileError: strings.Repeat("错", 2000), Results: make([]domain.TestResult, 30)}
	compact := compactAIExecution(execution)
	if len(compact.Results) != 20 || !utf8.ValidString(compact.CompileError) || !strings.HasSuffix(compact.CompileError, "（内容已截断）") || len(execution.Results) != 30 {
		t.Fatal("execution trimming corrupts data or original")
	}
}

func TestAIDetectionRetriesLimitationsContradictingAvailableFacts(t *testing.T) {
	for _, limitation := range []string{"无法获取生成历史或运行结果，仅基于静态代码特征判断", "未与参考实现比对，无法判断相似性来源"} {
		t.Run(limitation, func(t *testing.T) {
			client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
			calls := 0
			client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
				calls++
				output := validAIResult
				if calls == 1 {
					output = strings.Replace(output, "无法获取实际编写过程", limitation, 1)
				}
				return jsonResponse(output), nil
			})
			result, err := client.DetectAICode(context.Background(), domain.Assignment{Language: "Python", ReferenceSolution: "print(1)"}, "value = 1\nprint(value)", domain.AIDetectionContext{Execution: &domain.ExecutionEvidence{CompileOK: true}})
			if err != nil || calls != 2 || result.Limitations[0] != "无法获取实际编写过程" {
				t.Fatalf("contradictory boilerplate accepted: %+v %v calls=%d", result, err, calls)
			}
		})
	}
}

func TestAIDetectionCancellationStopsBeforeModel(t *testing.T) {
	service := aiContextService(t, func(aiVerification) { t.Fatal("cancelled request reached model") })
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := service.DetectAICode(ctx, domain.Assignment{}, "print(1)"); err != context.Canceled {
		t.Fatalf("cancellation lost: %v", err)
	}
}

func TestPublicFrameworkIsExcludedFromTeacherReferenceComparison(t *testing.T) {
	framework := "class Scheduler:\n    def __init__(self, data):\n        raise NotImplementedError\n    def handle(self, event):\n        raise NotImplementedError\n    def inspect(self):\n        raise NotImplementedError\n"
	assignment := domain.Assignment{Language: "Python", StarterCode: framework, ReferenceSolution: framework}
	verification := buildAIVerification(context.Background(), assignment, framework, domain.AIDetectionContext{})
	if verification.ReferenceStatus != "not_used" || verification.Reference != nil {
		t.Fatalf("framework counted as copied implementation: %+v", verification)
	}
	input := aiDetectionInput(assignment, framework, verification)
	if !strings.Contains(input, "starterCode") || !strings.Contains(strings.Join(verification.Checks, "\n"), "只分析学生新增实现") {
		t.Fatal("public framework role missing from model context")
	}
}

func TestOptionalArchiveAnswerCannotChangeAIInput(t *testing.T) {
	assignment := domain.Assignment{Title: "task", Language: "Python", StarterCode: "pass # TODO"}
	input := aiDetectionInput(assignment, "print(1)", buildAIVerification(context.Background(), assignment, "print(1)", domain.AIDetectionContext{}))
	assignment.ReferenceSolution = "private-answer-marker"
	changed := aiDetectionInput(assignment, "print(1)", buildAIVerification(context.Background(), assignment, "print(1)", domain.AIDetectionContext{}))
	if input != changed || strings.Contains(changed, "private-answer-marker") {
		t.Fatal("archive-only answer affected AI analysis")
	}
}
