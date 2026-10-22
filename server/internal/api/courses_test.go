package api

import (
	"net/http/httptest"
	"strings"
	"testing"

	"codeeval/server/internal/auth"
	"codeeval/server/internal/domain"
	"github.com/gin-gonic/gin"
)

func TestCourseEndpointsEnforceRolesAndValidateInputs(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{auth: auth.New("courses-test-secret", 1), supportedLanguages: map[string]bool{"python": true}}
	router := gin.New()
	h.Register(router.Group("/api"))
	for _, tt := range []struct {
		role, method, path, body string
		status                   int
	}{
		{"student", "POST", "/api/courses", `{"title":"课程"}`, 403},
		{"teacher", "POST", "/api/courses/1/enroll", `{}`, 403},
		{"student", "GET", "/api/assignments/1/students", ``, 403},
		{"student", "GET", "/api/courses/1/students", ``, 403},
		{"teacher", "GET", "/api/courses/invalid/students", ``, 400},
		{"teacher", "GET", "/api/courses/0/students", ``, 400},
		{"student", "POST", "/api/courses/invalid/enroll", `{}`, 400},
		{"student", "POST", "/api/courses/0/enroll", `{}`, 400},
		{"teacher", "POST", "/api/courses", `{"title":"   "}`, 400},
		{"teacher", "POST", "/api/assignments", `{"title":"作业","language":"Python","status":"open","dueAt":"2099-01-01T00:00:00Z","maxSubmissions":3,"rubric":[{"key":"correctness","name":"功能","weight":100}]}`, 400},
		{"teacher", "POST", "/api/courses", `{"title":"` + strings.Repeat("课", 101) + `"}`, 400},
		{"teacher", "POST", "/api/courses", `{"title":"课程","description":"` + strings.Repeat("字", 2001) + `"}`, 400},
	} {
		token, err := h.auth.Issue(1, tt.role, "用户")
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
		req.Header.Set("Authorization", "Bearer "+token)
		req.Header.Set("Content-Type", "application/json")
		res := httptest.NewRecorder()
		router.ServeHTTP(res, req)
		if res.Code != tt.status {
			t.Fatalf("%s %s as %s returned %d: %s", tt.method, tt.path, tt.role, res.Code, res.Body.String())
		}
	}
}
func TestTeachersCannotAccessOtherTeachersAssignments(t *testing.T) {
	h := &Handler{}
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	c.Set("identity", identity{ID: 7, Role: "teacher"})
	if h.canAccessAssignment(c, domain.Assignment{TeacherID: "8"}) {
		t.Fatal("another teacher's assignment is accessible")
	}
	if !h.canAccessAssignment(c, domain.Assignment{TeacherID: "7"}) {
		t.Fatal("own assignment is inaccessible")
	}
}
