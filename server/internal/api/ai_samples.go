package api

import (
	"errors"
	"net/http"
	"strconv"

	"codeeval/server/internal/domain"
	"codeeval/server/internal/evaluator"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) aiSampleAssignment(c *gin.Context) (domain.Assignment, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 || strconv.FormatUint(id, 10) != c.Param("id") {
		c.JSON(400, gin.H{"error": "作业编号无效"})
		return domain.Assignment{}, false
	}
	a, err := h.store.Assignment(uint(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "作业不存在或无权访问"})
		return a, false
	}
	if err != nil {
		serverError(c, err)
		return a, false
	}
	if !h.canAccessAssignment(c, a) {
		c.JSON(404, gin.H{"error": "作业不存在或无权访问"})
		return a, false
	}
	return a, true
}

func aiSampleResponse(bank *domain.AISampleBank) gin.H {
	status := "missing"
	if bank != nil && len(bank.Samples) > 0 {
		status = "partial"
		if len(bank.Samples) == evaluator.AISampleExpectedCount {
			status = "ready"
		}
	}
	return gin.H{"status": status, "expectedCount": evaluator.AISampleExpectedCount, "bank": bank}
}

func (h *Handler) readAssignmentAISamples(c *gin.Context) {
	a, ok := h.aiSampleAssignment(c)
	if !ok {
		return
	}
	bank, err := h.evaluator.ReadAISampleBank(c.Request.Context(), a)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": evaluator.AISampleFailureMessage(err), "code": "ai_sample_storage_error"})
		return
	}
	c.JSON(http.StatusOK, aiSampleResponse(bank))
}

func (h *Handler) generateAssignmentAISamples(c *gin.Context) {
	a, ok := h.aiSampleAssignment(c)
	if !ok {
		return
	}
	bank, err := h.evaluator.EnsureAISampleBank(c.Request.Context(), a)
	if err != nil {
		response := aiSampleResponse(bank)
		response["error"] = evaluator.AISampleFailureMessage(err)
		response["code"] = "ai_sample_generation_failed"
		c.JSON(http.StatusBadGateway, response)
		return
	}
	c.JSON(http.StatusOK, aiSampleResponse(bank))
}
