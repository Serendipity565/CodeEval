package api

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strconv"

	"codeeval/server/internal/domain"
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
		Regenerate   bool   `json:"regenerate"`
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
	result, err := detectAndSaveAI(c.Request.Context(), h.store, h.evaluator, uint(id), uint(n), assignment, sources[0].Code, input.Regenerate)
	if err != nil {
		aiDetectionError(c, err)
		return
	}
	c.JSON(http.StatusOK, result)
}

// Reading saved reports never calls the model, including when no report exists.
func (h *Handler) savedAssignmentAIDetection(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "作业编号无效"})
		return
	}
	var submissionID uint
	if c.Request.URL.Query().Has("submissionId") {
		value := c.Query("submissionId")
		n, err := strconv.ParseUint(value, 10, 64)
		if err != nil || n == 0 || strconv.FormatUint(n, 10) != value {
			c.JSON(http.StatusBadRequest, gin.H{"error": "请选择一份有效提交"})
			return
		}
		submissionID = uint(n)
	}
	results, err := h.store.SavedAIDetections(c.Request.Context(), uint(id), current(c).ID, submissionID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "作业或提交不存在，或无权访问"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	for i := range results {
		results[i] = evaluator.RecalculateAIScoring(results[i])
	}
	c.JSON(http.StatusOK, gin.H{"results": results})
}

type aiResultStore interface {
	AIDetectionResults(context.Context, uint, []string) ([]domain.AIDetection, error)
	SaveAIDetection(context.Context, uint, uint, domain.AIDetection) error
	AIDetectionContext(context.Context, uint, uint) (domain.AIDetectionContext, error)
}

type aiCodeDetector interface {
	DetectAICode(context.Context, domain.Assignment, string, ...domain.AIDetectionContext) (domain.AIDetection, error)
}

var errAIReportStorage = errors.New("AI report storage failed")

func detectAndSaveAI(ctx context.Context, repository aiResultStore, detector aiCodeDetector, assignmentID, submissionID uint, assignment domain.Assignment, code string, regenerate bool) (domain.AIDetection, error) {
	if !regenerate {
		previous, err := repository.AIDetectionResults(ctx, assignmentID, []string{strconv.FormatUint(uint64(submissionID), 10)})
		if err != nil {
			return domain.AIDetection{}, fmt.Errorf("%w: %v", errAIReportStorage, err)
		}
		if len(previous) > 0 {
			return evaluator.RecalculateAIScoring(previous[0]), nil
		}
	}
	material, err := repository.AIDetectionContext(ctx, assignmentID, submissionID)
	if err != nil {
		return domain.AIDetection{}, fmt.Errorf("%w: %v", errAIReportStorage, err)
	}
	result, err := detector.DetectAICode(ctx, assignment, code, material)
	if err != nil {
		return domain.AIDetection{}, err
	}
	result.SubmissionID = strconv.FormatUint(uint64(submissionID), 10)
	if err := repository.SaveAIDetection(ctx, assignmentID, submissionID, result); err != nil {
		return domain.AIDetection{}, fmt.Errorf("%w: %v", errAIReportStorage, err)
	}
	return result, nil
}

func aiDetectionError(c *gin.Context, err error) {
	var networkError net.Error
	var outputError *evaluator.ModelOutputError
	var sampleError *evaluator.AISampleError
	status, code, message := http.StatusBadGateway, "ai_service_error", "AI 服务调用失败，请稍后重试或联系管理员检查服务配置"
	switch {
	case errors.Is(err, errAIReportStorage):
		status, code, message = http.StatusInternalServerError, "ai_storage_error", "AI 报告读取或保存失败，请重试；原有报告仍保留"
	case errors.Is(err, evaluator.ErrAIUnavailable):
		status, code, message = http.StatusServiceUnavailable, "ai_unavailable", evaluator.ErrAIUnavailable.Error()
	case errors.Is(err, evaluator.ErrAIInput):
		status, code, message = http.StatusUnprocessableEntity, "ai_invalid_input", evaluator.ErrAIInput.Error()
	case errors.As(err, &sampleError):
		status, code, message = http.StatusServiceUnavailable, "ai_samples_not_ready", evaluator.AISampleFailureMessage(err)+"；本次识别未开始，请先完成样本准备后重试"
	case errors.Is(err, evaluator.ErrAISampleAssessment):
		code, message = "ai_sample_assessment_missing", evaluator.ErrAISampleAssessment.Error()
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
