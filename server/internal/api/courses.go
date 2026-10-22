package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"codeeval/server/internal/domain"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

func (h *Handler) courses(c *gin.Context) {
	i := current(c)
	items, err := h.store.ListCourses(i.ID, i.Role)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusOK, items)
}
func (h *Handler) createCourse(c *gin.Context) {
	var in struct {
		Title       string `json:"title"`
		Description string `json:"description"`
	}
	if c.ShouldBindJSON(&in) != nil {
		c.JSON(400, gin.H{"error": "课程信息格式不正确"})
		return
	}
	in.Title = strings.TrimSpace(in.Title)
	in.Description = strings.TrimSpace(in.Description)
	if utf8.RuneCountInString(in.Title) < 1 || utf8.RuneCountInString(in.Title) > 100 || utf8.RuneCountInString(in.Description) > 2000 {
		c.JSON(400, gin.H{"error": "课程名称需为 1–100 字，说明不超过 2000 字"})
		return
	}
	item, err := h.store.CreateCourse(current(c).ID, in.Title, in.Description)
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(201, item)
}
func (h *Handler) enrollCourse(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "课程编号不正确"})
		return
	}
	err = h.store.Enroll(uint(id), current(c).ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "课程不存在"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, gin.H{"enrolled": true})
}
func (h *Handler) canAccessAssignment(c *gin.Context, a domain.Assignment) bool {
	i := current(c)
	if i.Role == "teacher" {
		return a.TeacherID == strconv.FormatUint(uint64(i.ID), 10)
	}
	ok, err := h.store.Enrolled(parseCourseID(a.CourseID), i.ID)
	if err != nil {
		serverError(c, err)
		return false
	}
	return ok
}
func parseCourseID(id string) uint { n, _ := strconv.ParseUint(id, 10, 64); return uint(n) }
func (h *Handler) assignmentStudents(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(400, gin.H{"error": "作业编号不正确"})
		return
	}
	items, err := h.store.AssignmentStudents(uint(id), current(c).ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(404, gin.H{"error": "作业不存在或无权访问"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(200, items)
}

func (h *Handler) courseStudents(c *gin.Context) {
	id, err := strconv.ParseUint(c.Param("id"), 10, 64)
	if err != nil || id == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "课程编号不正确"})
		return
	}
	students, err := h.store.CourseStudents(uint(id), current(c).ID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusNotFound, gin.H{"error": "课程不存在或无权查看选课名单"})
		return
	}
	if err != nil {
		serverError(c, err)
		return
	}
	c.JSON(http.StatusOK, students)
}
