package store

import (
	"encoding/json"
	"errors"
	"time"

	"codeeval/server/internal/domain"
	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
)

const mockPassword = "CodeEval123!"

// SeedMockData inserts a small, repeatable development dataset. Every lookup uses
// stable business keys, so enabling it across restarts does not create duplicates.
func SeedMockData(s *MySQLStore) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		teacher, err := ensureMockUser(tx, "teacher", "李老师", "teacher")
		if err != nil {
			return err
		}
		student, err := ensureMockUser(tx, "student", "张同学", "student")
		if err != nil {
			return err
		}

		rubric, _ := json.Marshal([]domain.RubricItem{
			{Key: "correctness", Name: "功能正确性", Description: "通过公开与隐藏测试", Weight: 45},
			{Key: "robustness", Name: "鲁棒性", Description: "处理空输入、重复值和异常边界", Weight: 20},
			{Key: "quality", Name: "代码质量", Description: "结构、命名和可读性", Weight: 20},
			{Key: "efficiency", Name: "算法效率", Description: "时间和空间复杂度", Weight: 15},
		})
		assignment := AssignmentRecord{TeacherID: teacher.ID, Title: "两数之和：返回下标", Language: "Go", Description: "实现 twoSum，返回目标和对应的两个不同下标。", Status: "open", MaxSubmissions: 3, DueAt: time.Now().Add(72 * time.Hour), RubricJSON: rubric, LLMEvaluationEnabled: false}
		if err := tx.Where("teacher_id = ? AND title = ?", teacher.ID, assignment.Title).FirstOrCreate(&assignment).Error; err != nil {
			return err
		}

		evaluation, _ := json.Marshal(domain.Evaluation{Total: 92, MaxTotal: 100, Status: "graded", Provider: "rules", Summary: "示例提交结构清晰，建议补充无解场景的约定。", Strengths: []string{"使用哈希表一次遍历，结构简洁。"}, Issues: []string{"无解时返回 nil 的约定未说明。"}, Improvements: []string{"补充函数注释和无解场景测试。"}, ReviewedAt: time.Now(), Dimensions: []domain.DimensionScore{
			{Key: "correctness", Name: "功能正确性", Score: 45, MaxScore: 45, Evidence: "示例测试全部通过。", Suggestion: "保持。"},
			{Key: "robustness", Name: "鲁棒性", Score: 18, MaxScore: 20, Evidence: "无解时安全返回 nil。", Suggestion: "在注释中说明返回约定。"},
			{Key: "quality", Name: "代码质量", Score: 16, MaxScore: 20, Evidence: "职责明确，缺少函数注释。", Suggestion: "补充接口注释。"},
			{Key: "efficiency", Name: "算法效率", Score: 13, MaxScore: 15, Evidence: "使用哈希表一次遍历。", Suggestion: "注明空间复杂度 O(n)。"},
		}})
		submission := SubmissionRecord{AssignmentID: assignment.ID, StudentID: student.ID, Code: "func twoSum(nums []int, target int) []int {\n\tseen := map[int]int{}\n\tfor i, n := range nums {\n\t\tif j, ok := seen[target-n]; ok { return []int{j, i} }\n\t\tseen[n] = i\n\t}\n\treturn nil\n}", Status: "graded", EvaluationJSON: evaluation, SubmittedAt: time.Now().Add(-2 * time.Hour)}
		return tx.Where("assignment_id = ? AND student_id = ?", assignment.ID, student.ID).FirstOrCreate(&submission).Error
	})
}

func ensureMockUser(tx *gorm.DB, username, displayName, role string) (User, error) {
	var user User
	err := tx.Where("username = ?", username).First(&user).Error
	if err == nil {
		return user, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return user, err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(mockPassword), bcrypt.DefaultCost)
	if err != nil {
		return user, err
	}
	user = User{Username: username, DisplayName: displayName, Role: role, PasswordHash: string(hash)}
	return user, tx.Create(&user).Error
}
