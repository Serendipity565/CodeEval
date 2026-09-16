package api

import (
	"context"
	"errors"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"codeeval/server/internal/auth"
	"codeeval/server/internal/domain"
	"codeeval/server/internal/evaluator"
	"codeeval/server/internal/store"
	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

type Handler struct {
	store     *store.MySQLStore
	auth      auth.Service
	evaluator *evaluator.Service
}
type identity struct {
	ID         uint
	Role, Name string
}

func New(s *store.MySQLStore, authService auth.Service, evaluationService *evaluator.Service) *Handler {
	return &Handler{store: s, auth: authService, evaluator: evaluationService}
}
func (h *Handler) Register(r *gin.RouterGroup) {
	r.POST("/auth/login", h.login)
	secured := r.Group("", h.requireAuth)
	secured.GET("/me", h.me)
	secured.GET("/assignments", h.assignments)
	secured.GET("/assignments/:id", h.assignment)
	secured.GET("/submissions", h.submissions)
	secured.GET("/dashboard", h.dashboard)
	secured.POST("/assignments", h.requireRole("teacher"), h.createAssignment)
	secured.PATCH("/assignments/:id/status", h.requireRole("teacher"), h.updateAssignmentStatus)
	secured.PATCH("/assignments/:id/max-submissions", h.requireRole("teacher"), h.updateAssignmentMaxSubmissions)
	secured.POST("/submissions", h.requireRole("student"), h.createSubmission)
}
func (h *Handler) login(c *gin.Context) {
	var in struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Username == "" || in.Password == "" {
		c.JSON(400, gin.H{"error": "username and password are required"})
		return
	}
	u, err := h.store.FindUser(in.Username)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(in.Password)) != nil {
		c.JSON(401, gin.H{"error": "账号或密码错误"})
		return
	}
	token, err := h.auth.Issue(u.ID, u.Role, u.DisplayName)
	if err != nil {
		c.JSON(500, gin.H{"error": "failed to issue token"})
		return
	}
	c.JSON(200, gin.H{"accessToken": token, "user": gin.H{"id": u.ID, "username": u.Username, "displayName": u.DisplayName, "role": u.Role}})
}
func (h *Handler) requireAuth(c *gin.Context) {
	raw := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
	if raw == "" {
		c.JSON(401, gin.H{"error": "missing bearer token"})
		c.Abort()
		return
	}
	claims, err := h.auth.Parse(raw)
	if err != nil {
		c.JSON(401, gin.H{"error": "invalid or expired token"})
		c.Abort()
		return
	}
	c.Set("identity", identity{claims.UserID, claims.Role, claims.Name})
	c.Next()
}
func (h *Handler) requireRole(role string) gin.HandlerFunc {
	return func(c *gin.Context) {
		if current(c).Role != role {
			c.JSON(403, gin.H{"error": "insufficient role"})
			c.Abort()
			return
		}
		c.Next()
	}
}
func current(c *gin.Context) identity { v, _ := c.Get("identity"); return v.(identity) }
func (h *Handler) me(c *gin.Context) {
	i := current(c)
	c.JSON(200, gin.H{"id": i.ID, "displayName": i.Name, "role": i.Role})
}
func (h *Handler) assignments(c *gin.Context) {
	items, err := h.store.ListAssignments()
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, items)
}
func (h *Handler) assignment(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid assignment id"})
		return
	}
	a, err := h.store.Assignment(uint(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "assignment not found"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, a)
}
func (h *Handler) createAssignment(c *gin.Context) {
	var in struct {
		Title                string              `json:"title"`
		Language             string              `json:"language"`
		Description          string              `json:"description"`
		Status               string              `json:"status"`
		MaxSubmissions       int                 `json:"maxSubmissions"`
		DueAt                time.Time           `json:"dueAt"`
		Rubric               []domain.RubricItem `json:"rubric"`
		LLMEvaluationEnabled bool                `json:"llmEvaluationEnabled"`
		ReferenceSolution    string              `json:"referenceSolution"`
		KnowledgeBase        string              `json:"knowledgeBase"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.Title == "" || in.Language == "" || !validAssignmentStatus(in.Status) || in.MaxSubmissions < 1 || in.MaxSubmissions > 100 || !validRubric(in.Rubric) {
		c.JSON(400, gin.H{"error": "title, language, 1-100 submissions and a 100-point rubric are required"})
		return
	}
	if len([]byte(in.ReferenceSolution))+len([]byte(in.KnowledgeBase)) > 200000 {
		c.JSON(400, gin.H{"error": "reference material exceeds 200000 bytes"})
		return
	}
	a, err := h.store.CreateAssignment(current(c).ID, domain.Assignment{Title: in.Title, Language: in.Language, Description: in.Description, Status: in.Status, MaxSubmissions: in.MaxSubmissions, DueAt: in.DueAt, Rubric: in.Rubric, LLMEvaluationEnabled: in.LLMEvaluationEnabled, ReferenceSolution: in.ReferenceSolution, KnowledgeBase: in.KnowledgeBase})
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(201, a)
}
func (h *Handler) updateAssignmentStatus(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	var in struct {
		Status string `json:"status"`
	}
	if err != nil || c.ShouldBindJSON(&in) != nil || !validAssignmentStatus(in.Status) {
		c.JSON(400, gin.H{"error": "status must be open or closed"})
		return
	}
	if err = h.store.UpdateAssignmentStatus(uint(id), current(c).ID, in.Status); errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "assignment not found"})
		return
	} else if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, gin.H{"id": c.Param("id"), "status": in.Status})
}
func (h *Handler) updateAssignmentMaxSubmissions(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	var in struct {
		MaxSubmissions int `json:"maxSubmissions"`
	}
	if err != nil || c.ShouldBindJSON(&in) != nil || in.MaxSubmissions < 1 || in.MaxSubmissions > 100 {
		c.JSON(400, gin.H{"error": "maxSubmissions must be between 1 and 100"})
		return
	}
	if err = h.store.UpdateAssignmentMaxSubmissions(uint(id), current(c).ID, in.MaxSubmissions); errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "assignment not found"})
		return
	} else if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, gin.H{"id": c.Param("id"), "maxSubmissions": in.MaxSubmissions})
}
func (h *Handler) submissions(c *gin.Context) {
	i := current(c)
	items, err := h.store.ListSubmissions(i.ID, i.Role)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, items)
}
func (h *Handler) createSubmission(c *gin.Context) {
	var in struct {
		AssignmentID string `json:"assignmentId"`
		Code         string `json:"code"`
	}
	if err := c.ShouldBindJSON(&in); err != nil || in.AssignmentID == "" || in.Code == "" {
		c.JSON(400, gin.H{"error": "assignmentId and code are required"})
		return
	}
	id, err := strconv.ParseUint(in.AssignmentID, 10, 64)
	if err != nil {
		c.JSON(400, gin.H{"error": "invalid assignment id"})
		return
	}
	a, err := h.store.Assignment(uint(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "assignment not found"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	if a.Status != "open" {
		c.JSON(http.StatusConflict, gin.H{"error": "该作业当前未开放提交"})
		return
	}
	count, err := h.store.SubmissionCount(current(c).ID, uint(id))
	if err != nil {
		serverError(c, err)
		return
	}
	if count >= int64(a.MaxSubmissions) {
		c.JSON(http.StatusConflict, gin.H{"error": "已达到该作业的提交次数上限", "submitted": count, "limit": a.MaxSubmissions})
		return
	}
	history, err := h.store.SubmissionHistory(current(c).ID, uint(id), 3)
	if err != nil {
		serverError(c, err)
		return
	}
	sub := domain.Submission{AssignmentID: in.AssignmentID, StudentName: current(c).Name, Code: in.Code, Status: "queued", Progress: 10, SubmittedAt: time.Now()}
	sub, err = h.store.CreateSubmission(current(c).ID, sub)
	if err != nil {
		serverError(c, err)
		return
	}
	submissionID, _ := strconv.ParseUint(sub.ID, 10, 64)
	go h.evaluateSubmission(context.Background(), uint(submissionID), a, in.Code, history)
	c.JSON(http.StatusAccepted, sub)
}
func (h *Handler) evaluateSubmission(ctx context.Context, submissionID uint, assignment domain.Assignment, code string, history []domain.Submission) {
	if err := h.store.UpdateSubmissionProgress(submissionID, "evaluating", 35); err != nil {
		return
	}
	evaluation, err := h.evaluator.Evaluate(ctx, assignment, code, history)
	if err != nil {
		_ = h.store.UpdateSubmissionProgress(submissionID, "failed", 100)
		return
	}
	_ = h.store.CompleteSubmission(submissionID, evaluation)
}
func (h *Handler) dashboard(c *gin.Context) {
	i := current(c)
	subs, err := h.store.ListSubmissions(i.ID, i.Role)
	if err != nil {
		serverError(c, err)
		return
	}
	total := 0
	graded := 0
	scores := make([]float64, 0, len(subs))
	reviewQueue := 0
	type dimensionAccumulator struct {
		Count           int
		Sum, SumSquares float64
	}
	dimensionAccumulators := map[string]dimensionAccumulator{}
	for _, s := range subs {
		if s.Status == "failed" || s.Status == "needs_review" || (s.Evaluation != nil && s.Evaluation.Confidence < 0.5) {
			reviewQueue++
		}
		if s.Evaluation != nil {
			graded++
			total += s.Evaluation.Total
			scores = append(scores, float64(s.Evaluation.Total))
			for _, dimension := range s.Evaluation.Dimensions {
				acc := dimensionAccumulators[dimension.Key]
				acc.Count++
				acc.Sum += float64(dimension.Score)
				acc.SumSquares += float64(dimension.Score * dimension.Score)
				dimensionAccumulators[dimension.Key] = acc
			}
		}
	}
	avg := 0
	mean := 0.0
	if graded > 0 {
		avg = total / graded
		mean = float64(total) / float64(graded)
	}
	variance := 0.0
	for _, score := range scores {
		delta := score - mean
		variance += delta * delta
	}
	if graded > 0 {
		variance /= float64(graded)
	}
	dimensionStats := map[string]gin.H{}
	for key, acc := range dimensionAccumulators {
		dimensionMean := acc.Sum / float64(acc.Count)
		dimensionVariance := acc.SumSquares/float64(acc.Count) - dimensionMean*dimensionMean
		if dimensionVariance < 0 {
			dimensionVariance = 0
		}
		dimensionStats[key] = gin.H{"count": acc.Count, "mean": math.Round(dimensionMean*100) / 100, "variance": math.Round(dimensionVariance*100) / 100, "stdDev": math.Round(math.Sqrt(dimensionVariance)*100) / 100}
	}
	c.JSON(200, gin.H{"metrics": gin.H{"submissionCount": len(subs), "gradedCount": graded, "averageScore": avg, "scoreVariance": math.Round(variance*100) / 100, "scoreStdDev": math.Round(math.Sqrt(variance)*100) / 100, "dimensionStats": dimensionStats, "reviewQueue": reviewQueue}, "recentSubmissions": subs})
}
func serverError(c *gin.Context, err error) {
	c.Error(err)
	c.JSON(http.StatusInternalServerError, gin.H{"error": "database operation failed"})
}

func validRubric(items []domain.RubricItem) bool {
	if len(items) == 0 {
		return false
	}
	total := 0
	keys := map[string]bool{}
	for _, item := range items {
		if item.Key == "" || item.Name == "" || item.Weight <= 0 || keys[item.Key] {
			return false
		}
		keys[item.Key] = true
		total += item.Weight
	}
	return total == 100
}

func validAssignmentStatus(status string) bool { return status == "open" || status == "closed" }
