package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"codeeval/server/internal/auth"
	"codeeval/server/internal/store"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func TestAssessmentEndpointsRequireTeacher(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{auth: auth.New("assessment-test-secret", 1)}
	router := gin.New()
	handler.Register(router.Group("/api"))
	token, err := handler.auth.Issue(1, "student", "学生")
	if err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []struct{ method, path string }{{http.MethodGet, "/api/submissions/7/assessment"}, {http.MethodPost, "/api/submissions/7/reviews"}} {
		t.Run(endpoint.path, func(t *testing.T) {
			request := httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader(`{}`))
			request.Header.Set("Authorization", "Bearer "+token)
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)
			if response.Code != http.StatusForbidden {
				t.Fatalf("student received %d: %s", response.Code, response.Body.String())
			}
		})
	}
}

func TestReviewRejectsMissingVersionAndNonIntegerScores(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{auth: auth.New("assessment-test-secret", 1)}
	router := gin.New()
	handler.Register(router.Group("/api"))
	token, err := handler.auth.Issue(9, "teacher", "教师")
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range []string{`{"dimensions":[]}`, `{"expectedReviewId":null,"dimensions":[]}`, `{"expectedReviewId":"","dimensions":[{"key":"quality","score":1.5}]}`, `{"expectedReviewId":"","dimensions":[{"key":"quality","score":"20"}]}`} {
		request := httptest.NewRequest(http.MethodPost, "/api/submissions/7/reviews", strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		request.Header.Set("Content-Type", "application/json")
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusBadRequest {
			t.Fatalf("malformed review received %d: %s", response.Code, response.Body.String())
		}
	}
}

func TestAssessmentErrorsUseConflictAndOwnershipStatus(t *testing.T) {
	for _, item := range []struct {
		err    error
		status int
	}{{store.ErrReviewConflict, http.StatusConflict}, {store.ErrAssessmentPending, http.StatusConflict}, {store.ErrInvalidAssessment, http.StatusBadRequest}, {gorm.ErrRecordNotFound, http.StatusNotFound}} {
		response := httptest.NewRecorder()
		context, _ := gin.CreateTestContext(response)
		assessmentError(context, item.err)
		if response.Code != item.status {
			t.Fatalf("%v returned %d, want %d", item.err, response.Code, item.status)
		}
	}
}

func TestExpertScoringEndpointsRemoved(t *testing.T) {
	gin.SetMode(gin.TestMode)
	handler := &Handler{auth: auth.New("assessment-test-secret", 1)}
	router := gin.New()
	handler.Register(router.Group("/api"))
	token, err := handler.auth.Issue(9, "teacher", "教师")
	if err != nil {
		t.Fatal(err)
	}
	for _, endpoint := range []struct{ method, path string }{
		{http.MethodPost, "/api/submissions/7/expert-ratings"},
		{http.MethodGet, "/api/assignments/2/comparison"},
	} {
		request := httptest.NewRequest(endpoint.method, endpoint.path, strings.NewReader(`{}`))
		request.Header.Set("Authorization", "Bearer "+token)
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if response.Code != http.StatusNotFound {
			t.Fatalf("removed endpoint %s returned %d", endpoint.path, response.Code)
		}
	}
}
