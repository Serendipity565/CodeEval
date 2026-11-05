package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"codeeval/server/internal/auth"
	"codeeval/server/internal/domain"
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

func TestAISampleLibraryRoutesRequireTeacherAndValidAssignment(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{auth: auth.New("sample-library-test", 1)}
	r := gin.New()
	h.Register(r.Group("/api"))
	student, _ := h.auth.Issue(1, "student", "学生")
	teacher, _ := h.auth.Issue(2, "teacher", "教师")
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		for _, tc := range []struct {
			id, token string
			status    int
		}{{"2", "", 401}, {"2", student, 403}, {"bad", teacher, 400}, {"0", teacher, 400}, {"01", teacher, 400}} {
			req := httptest.NewRequest(method, "/api/assignments/"+tc.id+"/ai-samples", nil)
			req.Header.Set("Authorization", "Bearer "+tc.token)
			res := httptest.NewRecorder()
			r.ServeHTTP(res, req)
			if res.Code != tc.status {
				t.Fatalf("%s %s: got %d", method, tc.id, res.Code)
			}
		}
	}
	for _, tc := range []struct {
		count  int
		status string
	}{{0, "missing"}, {1, "partial"}, {2, "partial"}, {3, "ready"}} {
		bank := &domain.AISampleBank{Samples: make([]domain.AISample, tc.count)}
		if got := aiSampleResponse(bank)["status"]; got != tc.status {
			t.Fatalf("%d saved samples labeled %v", tc.count, got)
		}
	}
}

func TestSavedAIDetectionRequiresTeacherAndValidSelection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{auth: auth.New("saved-ai-test", 1)}
	r := gin.New()
	h.Register(r.Group("/api"))
	student, _ := h.auth.Issue(1, "student", "学生")
	teacher, _ := h.auth.Issue(2, "teacher", "教师")
	for _, tc := range []struct {
		path, token string
		status      int
	}{
		{"2", "", 401}, {"2", student, 403}, {"bad", teacher, 400}, {"0", teacher, 400},
		{"2?submissionId=", teacher, 400}, {"2?submissionId=01", teacher, 400},
		{"2?submissionId=-1", teacher, 400}, {"2?submissionId=0", teacher, 400},
	} {
		parts := strings.SplitN(tc.path, "?", 2)
		path := "/api/assignments/" + parts[0] + "/ai-detection"
		if len(parts) == 2 {
			path += "?" + parts[1]
		}
		req := httptest.NewRequest(http.MethodGet, path, nil)
		req.Header.Set("Authorization", "Bearer "+tc.token)
		res := httptest.NewRecorder()
		r.ServeHTTP(res, req)
		if res.Code != tc.status {
			t.Fatalf("%s: %d %s", tc.path, res.Code, res.Body.String())
		}
	}
}

type fakeAIReports struct {
	result           *domain.AIDetection
	readErr, saveErr error
	reads, saves     int
	contextReads     int
	contextErr       error
	material         domain.AIDetectionContext
}

func (s *fakeAIReports) AIDetectionResults(_ context.Context, assignmentID uint, ids []string) ([]domain.AIDetection, error) {
	s.reads++
	if assignmentID != 2 || len(ids) != 1 || ids[0] != "7" {
		panic("incorrect cache scope")
	}
	if s.result == nil || s.readErr != nil {
		return nil, s.readErr
	}
	return []domain.AIDetection{*s.result}, nil
}
func (s *fakeAIReports) SaveAIDetection(_ context.Context, assignmentID, submissionID uint, result domain.AIDetection) error {
	s.saves++
	if assignmentID != 2 || submissionID != 7 || result.SubmissionID != "7" {
		panic("incorrect save scope")
	}
	if s.saveErr == nil {
		s.result = &result
	}
	return s.saveErr
}

func (s *fakeAIReports) AIDetectionContext(_ context.Context, assignmentID, submissionID uint) (domain.AIDetectionContext, error) {
	s.contextReads++
	if assignmentID != 2 || submissionID != 7 {
		panic("incorrect context scope")
	}
	return s.material, s.contextErr
}

type fakeAIDetector struct {
	calls    int
	err      error
	material domain.AIDetectionContext
}

func (d *fakeAIDetector) DetectAICode(_ context.Context, _ domain.Assignment, _ string, materials ...domain.AIDetectionContext) (domain.AIDetection, error) {
	d.calls++
	if len(materials) != 0 {
		d.material = materials[0]
	}
	rate := 58.0
	return domain.AIDetection{Status: "estimated", AIRate: &rate, GeneratedAt: time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC)}, d.err
}

func TestAIReportsReuseSavedResultsUntilExplicitRegeneration(t *testing.T) {
	rate := 62.0
	old := domain.AIDetection{SubmissionID: "7", Status: "estimated", AIRate: &rate, GeneratedAt: time.Date(2026, 11, 4, 11, 0, 0, 0, time.UTC)}
	repository := &fakeAIReports{result: &old}
	detector := &fakeAIDetector{}
	for i := 0; i < 2; i++ {
		result, err := detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{}, "code", false)
		if err != nil || *result.AIRate != 62 || !result.GeneratedAt.Equal(old.GeneratedAt) {
			t.Fatalf("saved report changed: %+v %v", result, err)
		}
	}
	if detector.calls != 0 || repository.saves != 0 || repository.contextReads != 0 {
		t.Fatal("cache hit invoked model or saved again")
	}
	result, err := detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{}, "code", true)
	if err != nil || *result.AIRate != 58 || detector.calls != 1 || repository.saves != 1 || repository.reads != 2 {
		t.Fatalf("regeneration did not replace report: %+v %v", result, err)
	}
	result, err = detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{}, "code", false)
	if err != nil || *result.AIRate != 58 || detector.calls != 1 {
		t.Fatal("new result was not reused")
	}
}

func TestSavedPercentReportRecalculationDoesNotCallModelOrOverwriteSnapshot(t *testing.T) {
	oldRate := 58.5
	old := domain.AIDetection{SubmissionID: "7", ScoringVersion: "dimensions-v5", Status: "estimated", AIRate: &oldRate, GeneratedAt: time.Date(2026, 11, 5, 6, 0, 0, 0, time.UTC)}
	scores := []int{62, 55, -1, 40, -1}
	for i, key := range []string{"task_fit", "structure", "comments", "sample_match", "history"} {
		d := domain.AIDimension{Key: key, Reason: "saved analysis", Status: "insufficient_evidence", Strength: "none", Evidence: []domain.AIEvidence{}}
		if scores[i] >= 0 {
			score := scores[i]
			d.Status, d.Score, d.Strength, d.Alternative = "assessed", &score, "weak", "other explanation"
			d.Evidence = []domain.AIEvidence{{StartLine: 7, EndLine: 8, Quote: "verified source", Explanation: "saved verified citation"}}
		}
		old.Dimensions = append(old.Dimensions, d)
	}
	before, _ := json.Marshal(old)
	repository := &fakeAIReports{result: &old}
	detector := &fakeAIDetector{}
	result, err := detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{}, "code", false)
	if err != nil || result.ScoringVersion != "dimensions-v6" || result.AIRate == nil || *result.AIRate != 52.3 || !result.Dimensions[3].Included {
		t.Fatalf("saved original sample value not included: %+v %v", result, err)
	}
	if detector.calls != 0 || repository.saves != 0 || repository.contextReads != 0 {
		t.Fatal("view recalculation invoked a model, fetched source, or wrote storage")
	}
	after, _ := json.Marshal(old)
	if string(before) != string(after) || !result.GeneratedAt.Equal(old.GeneratedAt) {
		t.Fatal("view recalculation changed stored snapshot or its analysis time")
	}
}

func TestAIReportsGenerateMissingAndPreservePreviousOnFailure(t *testing.T) {
	for _, tc := range []struct {
		name                                    string
		cached, force, modelFails, storageFails bool
	}{
		{"first generation", false, false, false, false},
		{"model failure", true, true, true, false},
		{"save failure", true, true, false, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			repository := &fakeAIReports{}
			if tc.cached {
				repository.result = &domain.AIDetection{SubmissionID: "7", Summary: "previous", Status: "insufficient_evidence"}
			}
			previous := repository.result
			detector := &fakeAIDetector{}
			if tc.modelFails {
				detector.err = errors.New("model failed")
			}
			if tc.storageFails {
				repository.saveErr = errors.New("db failed")
			}
			_, err := detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{}, "code", tc.force)
			if detector.calls != 1 {
				t.Fatal("model call count")
			}
			if tc.modelFails || tc.storageFails {
				if err == nil || repository.result != previous {
					t.Fatal("failed generation replaced previous report")
				}
			} else if err != nil || repository.result == nil {
				t.Fatalf("first generation not saved: %v", err)
			}
		})
	}
	broken := &fakeAIReports{readErr: errors.New("read failed")}
	detector := &fakeAIDetector{}
	_, err := detectAndSaveAI(context.Background(), broken, detector, 2, 7, domain.Assignment{}, "code", false)
	if !errors.Is(err, errAIReportStorage) || detector.calls != 0 {
		t.Fatal("storage failure was treated as cache miss")
	}
}

func TestAIReportsReuseInsufficientEvidenceAfterAssignmentChanges(t *testing.T) {
	old := domain.AIDetection{SubmissionID: "7", Status: "insufficient_evidence", Summary: "证据不足", GeneratedAt: time.Now().UTC()}
	repository := &fakeAIReports{result: &old}
	detector := &fakeAIDetector{err: evaluator.ErrAIUnavailable}
	result, err := detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{Description: "updated", ReferenceSolution: "changed"}, "code", false)
	if err != nil || result.Status != old.Status || result.AIRate != nil || !result.GeneratedAt.Equal(old.GeneratedAt) || detector.calls != 0 || repository.saves != 0 {
		t.Fatalf("saved insufficient-evidence report not reused: %+v %v", result, err)
	}
}

func TestAIDetectionErrorsExplainActualFailure(t *testing.T) {
	for _, test := range []struct {
		err           error
		status        int
		code, message string
	}{
		{fmt.Errorf("detect: %w", evaluator.ErrAIEvidence), 502, "ai_evidence_mismatch", "代码依据无法与源码对应"},
		{&evaluator.ModelOutputError{Err: evaluator.ErrAISampleAssessment}, 502, "ai_sample_assessment_missing", "未返回有效的样本维度评分"},
		{&evaluator.ModelOutputError{Err: fmt.Errorf("invalid JSON secret-upstream-body")}, 502, "ai_invalid_response", "结果格式不完整"},
		{fmt.Errorf("call: %w", context.DeadlineExceeded), 504, "ai_timeout", "服务响应超时"},
		{evaluator.ErrAIUnavailable, 503, "ai_unavailable", "检查现有 AI 服务配置"},
		{evaluator.ErrAIInput, 422, "ai_invalid_input", "代码为空"},
		{&evaluator.AISampleError{Stage: "样本读取", Err: errors.New("secret-upstream-body")}, 503, "ai_samples_not_ready", "本次识别未开始"},
		{fmt.Errorf("%w: secret-upstream-body", errAIReportStorage), 500, "ai_storage_error", "原有报告仍保留"},
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

func TestAIReportsLoadContextOnlyForGenerationAndPreserveReportIfContextFails(t *testing.T) {
	previous := &domain.AIDetection{Summary: "previous"}
	repository := &fakeAIReports{result: previous, contextErr: errors.New("context read failed")}
	detector := &fakeAIDetector{}
	_, err := detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{}, "code", true)
	if !errors.Is(err, errAIReportStorage) || detector.calls != 0 || repository.saves != 0 || repository.result != previous {
		t.Fatalf("context failure overwrote report or invoked model: %v", err)
	}
	repository.contextErr = nil
	repository.material = domain.AIDetectionContext{Execution: &domain.ExecutionEvidence{CompileOK: true, Passed: 1}, History: []domain.Submission{{ID: "6", Code: "prior"}}}
	_, err = detectAndSaveAI(context.Background(), repository, detector, 2, 7, domain.Assignment{}, "code", true)
	if err != nil || detector.material.Execution != repository.material.Execution || len(detector.material.History) != 1 || detector.material.History[0].ID != "6" {
		t.Fatalf("context not passed to detector: %+v %v", detector.material, err)
	}
}
