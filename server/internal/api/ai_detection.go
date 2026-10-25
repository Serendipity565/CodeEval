package api

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strconv"

	"codeeval/server/internal/evaluator"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) assignmentAIDetection(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "作业编号无效"})
		return
	}
	var input struct {
		SubmissionID string `json:"submissionId"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 4096)
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "AI 识别参数无效"})
		return
	}
	n, err := strconv.ParseUint(input.SubmissionID, 10, 64)
	if err != nil || n == 0 || strconv.FormatUint(n, 10) != input.SubmissionID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择一份有效提交"})
		return
	}
	// Use the same ownership and assignment scope as the similarity endpoint.
	sources, err := h.store.SimilaritySubmissions(c.Request.Context(), uint(id), current(c).ID, []string{input.SubmissionID})
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "作业不存在或无权访问"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	if len(sources) != 1 {
		c.JSON(http.StatusNotFound, gin.H{"error": "提交不存在或不属于本次作业"})
		return
	}
	assignment, err := h.store.Assignment(uint(id))
	if err != nil {
		serverError(c, err)
		return
	}
	result, err := h.evaluator.DetectAICode(c.Request.Context(), assignment, sources[0].Code)
	if err != nil {
		aiDetectionError(c, err)
		return
	}
	result.SubmissionID = input.SubmissionID
	c.JSON(http.StatusOK, result)
}

func aiDetectionError(c *gin.Context, err error) {
	var networkError net.Error
	var outputError *evaluator.ModelOutputError
	status, code, message := http.StatusBadGateway, "ai_service_error", "AI 服务调用失败，请稍后重试或联系管理员检查服务配置"
	switch {
	case errors.Is(err, evaluator.ErrAIUnavailable):
		status, code, message = http.StatusServiceUnavailable, "ai_unavailable", evaluator.ErrAIUnavailable.Error()
	case errors.Is(err, evaluator.ErrAIInput):
		status, code, message = http.StatusUnprocessableEntity, "ai_invalid_input", evaluator.ErrAIInput.Error()
	case errors.Is(err, evaluator.ErrAIEvidence):
		code, message = "ai_evidence_mismatch", evaluator.ErrAIEvidence.Error()
	case errors.As(err, &outputError):
		code, message = "ai_invalid_response", "AI 返回结果格式不完整，重试后仍无效，请重新识别"
	case errors.Is(err, context.DeadlineExceeded) || errors.As(err, &networkError) && networkError.Timeout():
		status, code, message = http.StatusGatewayTimeout, "ai_timeout", "AI 服务响应超时，请稍后重试"
	}
	c.Error(err)
	c.JSON(status, gin.H{"error": message, "code": code})
}
