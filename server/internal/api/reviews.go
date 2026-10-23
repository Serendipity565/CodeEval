package api

import (
	"errors"
	"net/http"
	"strconv"

	"codeeval/server/internal/domain"
	"codeeval/server/internal/store"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func assessmentSubmissionID(c *gin.Context) (uint, bool) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "提交编号不合法"})
		return 0, false
	}
	return uint(id), true
}

func assessmentError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "提交不存在或不属于您发布的作业"})
	case errors.Is(err, store.ErrReviewConflict), errors.Is(err, store.ErrAssessmentPending):
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
	case errors.Is(err, store.ErrInvalidAssessment):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	default:
		serverError(c, err)
	}
}

func (h *Handler) submissionAssessment(c *gin.Context) {
	id, ok := assessmentSubmissionID(c)
	if !ok {
		return
	}
	reviews, err := h.store.SubmissionAssessment(id, current(c).ID)
	if err != nil {
		assessmentError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"reviews": reviews})
}

func (h *Handler) createReview(c *gin.Context) {
	id, ok := assessmentSubmissionID(c)
	if !ok {
		return
	}
	var input domain.ReviewInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "复核信息格式不正确，分数必须为整数"})
		return
	}
	if input.ExpectedReviewID == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "缺少复核版本，请刷新后重试；首次复核版本为空字符串"})
		return
	}
	submission, err := h.store.CreateReview(id, current(c).ID, current(c).Name, input)
	if err != nil {
		assessmentError(c, err)
		return
	}
	c.JSON(http.StatusCreated, submission)
}
