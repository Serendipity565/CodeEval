package evaluator

import (
	"context"
	"io"
	"net/http"
	"strings"
	"sync/atomic"
	"testing"

	"codeeval/server/internal/domain"
)

func TestAnalyzeStatic(t *testing.T) {
	code := "// TODO: explain\nfunc solve() {\n for i := 0; i < 3; i++ {\n  if i > 0 {}\n }\n}\n"
	got := AnalyzeStatic("Go", code)
	if got.NonEmptyLines != 6 || got.CommentLines != 1 || got.FunctionHints != 1 || got.LoopCount != 1 || got.BranchCount != 1 {
		t.Fatalf("unexpected report: %+v", got)
	}
	if len(got.Warnings) != 1 || !strings.Contains(got.Warnings[0], "TODO") {
		t.Fatalf("expected TODO warning, got %+v", got.Warnings)
	}
}

func TestValidateAndNormalize(t *testing.T) {
	rubric := []domain.RubricItem{{Key: "correctness", Name: "正确性", Weight: 60}, {Key: "quality", Name: "质量", Weight: 40}}
	result := domain.Evaluation{Summary: "评估完成", Strengths: []string{"结构清晰"}, Issues: []string{"缺少测试"}, Improvements: []string{"补充测试"}, Dimensions: []domain.DimensionScore{
		{Key: "quality", Score: 99, Evidence: "命名清晰", Suggestion: "补充注释"},
		{Key: "correctness", Score: -2, Evidence: "未经执行验证", Suggestion: "运行测试"},
	}}
	if err := validateAndNormalize(&result, rubric); err != nil {
		t.Fatal(err)
	}
	if result.Total != 40 || result.Dimensions[0].Key != "correctness" || result.Dimensions[1].Score != 40 {
		t.Fatalf("unexpected normalized result: %+v", result)
	}
}

func TestValidateRejectsDuplicateAndEmptyEvidence(t *testing.T) {
	rubric := []domain.RubricItem{{Key: "quality", Name: "质量", Weight: 100}}
	duplicate := domain.Evaluation{Dimensions: []domain.DimensionScore{{Key: "quality"}, {Key: "quality"}}}
	if err := validateAndNormalize(&duplicate, rubric); err == nil {
		t.Fatal("expected duplicate rubric error")
	}
	empty := domain.Evaluation{Dimensions: []domain.DimensionScore{{Key: "quality", Score: 50}}}
	if err := validateAndNormalize(&empty, rubric); err == nil {
		t.Fatal("expected empty evidence error")
	}
}

func TestDemoEvaluatorFollowsCustomRubric(t *testing.T) {
	rubric := []domain.RubricItem{{Key: "design", Name: "设计", Weight: 30}, {Key: "tests", Name: "测试", Weight: 70}}
	got := Evaluate("func main() {}", rubric)
	if len(got.Dimensions) != 2 || got.Dimensions[0].Key != "design" || got.Dimensions[1].MaxScore != 70 {
		t.Fatalf("demo result does not follow rubric: %+v", got)
	}
	if got.Status != "needs_review" {
		t.Fatalf("expected needs_review, got %q", got.Status)
	}
}

func TestDeepSeekRetriesTransientFailure(t *testing.T) {
	var calls atomic.Int32
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		if calls.Add(1) == 1 {
			return &http.Response{StatusCode: http.StatusInternalServerError, Status: "500 Internal Server Error", Body: io.NopCloser(strings.NewReader(`{"error":{"message":"temporary"}}`))}, nil
		}
		return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Body: io.NopCloser(strings.NewReader(`{"choices":[{"message":{"content":"{\"summary\":\"结构清晰\",\"strengths\":[\"职责单一\"],\"issues\":[\"缺少测试\"],\"improvements\":[\"补充测试\"],\"dimensions\":[{\"key\":\"quality\",\"score\":80,\"evidence\":\"函数职责单一\",\"suggestion\":\"补充测试\"}]}"}}]}`))}, nil
	})

	client := NewDeepSeekClient("https://example.invalid", "test-key", "test-model", 2, 256)
	client.httpClient.Transport = transport
	assignment := domain.Assignment{Title: "test", Language: "Go", Rubric: []domain.RubricItem{{Key: "quality", Name: "质量", Weight: 100}}}
	result, err := client.Evaluate(context.Background(), assignment, "func main() {}")
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 || result.Total != 80 || result.Provider != "deepseek" {
		t.Fatalf("unexpected retry result: calls=%d result=%+v", calls.Load(), result)
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
