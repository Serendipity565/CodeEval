package evaluator

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"reflect"
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
	result := domain.Evaluation{Summary: "评估完成", Strengths: []string{"结构清晰"}, Issues: []string{"缺少测试"}, Improvements: []string{"补充测试"}, Confidence: 0.7, Dimensions: []domain.DimensionScore{
		{Key: "quality", Score: 99, Evidence: "命名清晰", Suggestion: "补充注释", Confidence: 0.8, EvidenceType: "static"},
		{Key: "correctness", Score: -2, Evidence: "未经执行验证", Suggestion: "运行测试", Confidence: 0.4, EvidenceType: "llm_inference"},
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
		n := calls.Add(1)
		if n == 1 {
			return &http.Response{StatusCode: http.StatusInternalServerError, Status: "500 Internal Server Error", Body: io.NopCloser(strings.NewReader(`{"error":{"message":"temporary"}}`))}, nil
		}
		if n == 2 {
			return jsonResponse(`{"summary":"完成事实分析","strengths":["职责单一"],"findings":[{"category":"maintainability","severity":"low","location":"main","evidence":"单个函数","explanation":"结构简单"}],"limitations":["未经执行"]}`), nil
		}
		return jsonResponse(`{"summary":"结构清晰","strengths":["职责单一"],"issues":["缺少测试"],"improvements":["补充测试"],"confidence":0.7,"dimensions":[{"key":"quality","score":80,"evidence":"函数职责单一","suggestion":"补充测试","confidence":0.8,"verified":false,"evidenceType":"static"}]}`), nil
	})

	client := NewDeepSeekClient("https://example.invalid", "test-key", "test-model", 2, 256)
	client.httpClient.Transport = transport
	assignment := domain.Assignment{Title: "test", Language: "Go", Rubric: []domain.RubricItem{{Key: "quality", Name: "质量", Weight: 100}}}
	result, err := client.Evaluate(context.Background(), assignment, "func main() {}", nil)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 3 || result.Total != 80 || result.Provider != "deepseek-agent" || result.ModelCalls != 3 {
		t.Fatalf("unexpected retry result: calls=%d result=%+v", calls.Load(), result)
	}
}

func TestDeepSeekUsesTeacherContextInBothStages(t *testing.T) {
	requests := make([]chatRequest, 0, 2)
	transport := roundTripFunc(func(r *http.Request) (*http.Response, error) {
		var request chatRequest
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Fatal(err)
		}
		requests = append(requests, request)
		if len(requests) == 1 {
			return jsonResponse(`{"summary":"完成事实分析","strengths":["结构清晰"],"findings":[],"limitations":["未经执行"]}`), nil
		}
		return jsonResponse(`{"summary":"符合要求","strengths":["结构清晰"],"issues":["缺少注释"],"improvements":["补充注释"],"confidence":0.7,"dimensions":[{"key":"quality","score":80,"evidence":"结构清晰","suggestion":"补充注释","confidence":0.7,"verified":false,"evidenceType":"reference_comparison"}]}`), nil
	})
	client := NewDeepSeekClient("https://example.invalid", "test-key", "test-model", 2, 256)
	client.httpClient.Transport = transport
	assignment := domain.Assignment{
		Title: "上下文测试", Language: "Go", Description: "必须处理空输入",
		ReferenceSolution: "reference-marker", KnowledgeBase: "knowledge-marker",
		Rubric: []domain.RubricItem{{Key: "quality", Name: "质量", Description: "遵守课程约定", Weight: 100}},
	}
	result, err := client.Evaluate(context.Background(), assignment, "func main() {}", nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(requests) != 2 {
		t.Fatalf("expected two model stages, got %d", len(requests))
	}
	for i, request := range requests {
		if len(request.Messages) < 2 {
			t.Fatalf("stage %d has no user prompt", i+1)
		}
		prompt := request.Messages[1].Content
		for _, marker := range []string{"必须处理空输入", "reference-marker", "knowledge-marker", "遵守课程约定"} {
			if !strings.Contains(prompt, marker) {
				t.Errorf("stage %d is missing teacher context %q", i+1, marker)
			}
		}
	}
	wantSources := []string{"assignment_instructions", "grading_rubric", "reference_solution", "course_knowledge_base"}
	if !reflect.DeepEqual(result.ContextSources, wantSources) {
		t.Fatalf("unexpected context sources: got %v want %v", result.ContextSources, wantSources)
	}
}

func TestDecodeJSONObjectFromFence(t *testing.T) {
	var got map[string]string
	if err := decodeJSONObject("说明\n```json\n{\"status\":\"ok\"}\n```", &got); err != nil {
		t.Fatal(err)
	}
	if got["status"] != "ok" {
		t.Fatalf("unexpected decoded object: %+v", got)
	}
}

func TestEvidencePolicyCapsUnverifiedSyntaxFailure(t *testing.T) {
	rubric := []domain.RubricItem{{Key: "correctness", Name: "功能正确性", Weight: 100}}
	result := domain.Evaluation{Total: 95, Confidence: 0.9, Dimensions: []domain.DimensionScore{{Key: "correctness", Score: 95, Confidence: 0.9, Evidence: "从代码推测可工作", EvidenceType: "llm_inference"}}}
	static := StaticEvidence{SyntaxChecked: true, SyntaxValid: false}
	if err := applyEvidencePolicy(&result, static, domain.Assignment{Rubric: rubric}); err != nil {
		t.Fatal(err)
	}
	if result.Total != 20 || result.Dimensions[0].Confidence != 0.65 || result.Confidence > 0.65 {
		t.Fatalf("evidence policy was not applied: %+v", result)
	}
}

func TestAssignmentReferenceMaterialIsPrivate(t *testing.T) {
	assignment := domain.Assignment{ReferenceSolution: "secret solution", KnowledgeBase: "secret mistakes", HasReferenceMaterial: true}
	data, err := json.Marshal(assignment)
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Contains(text, "secret solution") || strings.Contains(text, "secret mistakes") || !strings.Contains(text, "hasReferenceMaterial") {
		t.Fatalf("reference material leaked in assignment JSON: %s", text)
	}
}

func jsonResponse(content string) *http.Response {
	payload, _ := json.Marshal(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}}}})
	return &http.Response{StatusCode: http.StatusOK, Status: "200 OK", Body: io.NopCloser(bytes.NewReader(payload))}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (f roundTripFunc) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
