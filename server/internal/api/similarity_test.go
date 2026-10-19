package api

import (
	"codeeval/server/internal/auth"
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSimilarityRequiresTeacherAndValidSelection(t *testing.T) {
	gin.SetMode(gin.TestMode)
	h := &Handler{auth: auth.New("similarity-test", 1)}
	r := gin.New()
	h.Register(r.Group("/api"))
	student, _ := h.auth.Issue(1, "student", "学生")
	teacher, _ := h.auth.Issue(2, "teacher", "教师")
	for _, test := range []struct {
		path, body, token string
		status            int
	}{
		{"2", `{}`, "", http.StatusUnauthorized}, {"2", `{}`, student, http.StatusForbidden},
		{"bad", `{}`, teacher, http.StatusBadRequest}, {"0", `{}`, teacher, http.StatusBadRequest},
		{"2", `{"submissionIds":["1"]}`, teacher, http.StatusBadRequest}, {"2", `{"submissionIds":["1","1"]}`, teacher, http.StatusBadRequest},
		{"2", `{"submissionIds":["1","bad"]}`, teacher, http.StatusBadRequest}, {"2", `{"submissionIds":["01","2"]}`, teacher, http.StatusBadRequest},
		{"2", `{"submissionIds":["1","2","3"]}`, teacher, http.StatusBadRequest}, {"2", `{"template":"` + strings.Repeat("a", 64001) + `"}`, teacher, http.StatusBadRequest},
		{"2", `{invalid`, teacher, http.StatusBadRequest},
	} {
		t.Run(test.path+test.body[:min(len(test.body), 40)]+test.token[:min(4, len(test.token))], func(t *testing.T) {
			req := httptest.NewRequest("POST", "/api/assignments/"+test.path+"/similarity", strings.NewReader(test.body))
			req.Header.Set("Content-Type", "application/json")
			if test.token != "" {
				req.Header.Set("Authorization", "Bearer "+test.token)
			}
			resp := httptest.NewRecorder()
			r.ServeHTTP(resp, req)
			if resp.Code != test.status {
				t.Fatalf("got %d, want %d: %s", resp.Code, test.status, resp.Body.String())
			}
		})
	}
}
