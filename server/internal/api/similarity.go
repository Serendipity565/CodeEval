package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"codeeval/server/internal/domain"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) assignmentSimilarity(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "作业编号无效"})
		return
	}
	var input struct {
		SubmissionIDs []string `json:"submissionIds"`
		Template      string   `json:"template"`
	}
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 128*1024)
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "查重参数无效"})
		return
	}
	if len(input.SubmissionIDs) != 0 && len(input.SubmissionIDs) != 2 || len(input.Template) > 64000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择两份不同的提交，或留空检测全班；公共代码最多 64000 字节"})
		return
	}
	for _, value := range input.SubmissionIDs {
		n, e := strconv.ParseUint(value, 10, 64)
		if e != nil || n == 0 || strconv.FormatUint(n, 10) != value {
			c.JSON(http.StatusBadRequest, gin.H{"error": "提交编号无效"})
			return
		}
	}
	if len(input.SubmissionIDs) == 2 && input.SubmissionIDs[0] == input.SubmissionIDs[1] {
		c.JSON(http.StatusBadRequest, gin.H{"error": "请选择两份不同的提交"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()
	submissions, err := h.store.SimilaritySubmissions(ctx, uint(id), current(c).ID, input.SubmissionIDs)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "作业不存在或无权访问"})
		return
	}
	if errors.Is(err, domain.ErrSimilarityLimit) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": err.Error()})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	if len(input.SubmissionIDs) == 2 && len(submissions) != 2 {
		c.JSON(http.StatusNotFound, gin.H{"error": "提交不存在或不属于本次作业"})
		return
	}
	assignment, err := h.store.Assignment(uint(id))
	if err != nil {
		serverError(c, err)
		return
	}
	selection := "latest_per_student"
	if len(input.SubmissionIDs) == 2 {
		selection = "selected_pair"
		// Preserve the teacher's A/B selection order in coverage and evidence.
		if submissions[0].ID != input.SubmissionIDs[0] {
			submissions[0], submissions[1] = submissions[1], submissions[0]
		}
	}
	report, err := domain.BuildSimilarity(ctx, strconv.FormatUint(id, 10), assignment.Language, selection, input.Template, submissions)
	if errors.Is(err, domain.ErrSimilarityLimit) || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "本次检测超出处理限制，请选择两份提交进行比对"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusOK, report)
}
