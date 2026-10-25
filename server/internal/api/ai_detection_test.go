package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"codeeval/server/internal/auth"
	"codeeval/server/internal/evaluator"
	"github.com/gin-gonic/gin"
)

func TestAIDetectionRequiresTeacherAndValidSubmission(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{auth: auth.New("ai-detection-test", 1)}
	r := gin.New()
	h.Register(r.Group("/api"))
	student, _ := h.auth.Issue(1, "student", "学生")
	teacher, _ := h.auth.Issue(2, "teacher", "教师")
	for _, test := range []struct {
		path, body, token string
		status            int
	}{
		{"2", `{"submissionId":"1"}`, "", http.StatusUnauthorized},
		{"2", `{"submissionId":"1"}`, student, http.StatusForbidden},
		{"bad", `{}`, teacher, http.StatusBadRequest},
		{"0", `{}`, teacher, http.StatusBadRequest},
		{"2", `{}`, teacher, http.StatusBadRequest},
		{"2", `{"submissionId":"0"}`, teacher, http.StatusBadRequest},
		{"2", `{"submissionId":"01"}`, teacher, http.StatusBadRequest},
		{"2", `{"submissionId":"-1"}`, teacher, http.StatusBadRequest},
		{"2", `{"submissionId":1}`, teacher, http.StatusBadRequest},
		{"2", `{invalid`, teacher, http.StatusBadRequest},
		{"2", `{"submissionId":"` + strings.Repeat("1", 4096) + `"}`, teacher, http.StatusBadRequest},
	} {
		req := httptest.NewRequest(http.MethodPost, "/api/assignments/"+test.path+"/ai-detection", strings.NewReader(test.body))
		req.Header.Set("Content-Type", "application/json")
		if test.token != "" {
			req.Header.Set("Authorization", "Bearer "+test.token)
		}
		response := httptest.NewRecorder()
		r.ServeHTTP(response, req)
		if response.Code != test.status {
			t.Fatalf("got %d, want %d: %s", response.Code, test.status, response.Body.String())
		}
	}
}

func TestAIDetectionErrorsExplainActualFailure(t *testing.T) {
	for _, test := range []struct {
		err           error
		status        int
		code, message string
	}{
		{fmt.Errorf("detect: %w", evaluator.ErrAIEvidence), 502, "ai_evidence_mismatch", "代码依据无法与源码对应"},
		{&evaluator.ModelOutputError{Err: fmt.Errorf("invalid JSON secret-upstream-body")}, 502, "ai_invalid_response", "结果格式不完整"},
		{fmt.Errorf("call: %w", context.DeadlineExceeded), 504, "ai_timeout", "服务响应超时"},
		{evaluator.ErrAIUnavailable, 503, "ai_unavailable", "检查现有 AI 服务配置"},
		{evaluator.ErrAIInput, 422, "ai_invalid_input", "代码为空"},
		{fmt.Errorf("upstream internal secret-upstream-body"), 502, "ai_service_error", "AI 服务调用失败"},
	} {
		response := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(response)
		aiDetectionError(c, test.err)
		var body struct {
			Error string `json:"error"`
			Code  string `json:"code"`
		}
		if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if response.Code != test.status || body.Code != test.code || !strings.Contains(body.Error, test.message) || strings.Contains(body.Error, "secret-upstream-body") {
			t.Fatalf("incorrect error response: %d %s", response.Code, response.Body.String())
		}
	}
}
