package api

import (
	"errors"
	"net/http"
	"strconv"

	"codeeval/server/internal/domain"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) assignmentComparison(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "作业编号无效"})
		return
	}
	submissions, ratings, err := h.store.AssignmentComparisonData(uint(id), current(c).ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "作业不存在或无权访问"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusOK, domain.BuildComparison(strconv.FormatUint(id, 10), submissions, ratings))
}
