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
		referenceSolution := "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tvar n, target int\n\tfmt.Scan(&n, &target)\n\tseen := map[int]int{}\n\tfor i := 0; i < n; i++ {\n\t\tvar value int\n\t\tfmt.Scan(&value)\n\t\tif j, ok := seen[target-value]; ok {\n\t\t\tfmt.Println(j, i)\n\t\t\treturn\n\t\t}\n\t\tseen[value] = i\n\t}\n\tfmt.Println(-1, -1)\n}\n"
		knowledgeBase := "核心知识点：哈希表、补数查找和单次遍历。要求输出两个不同元素的零基下标；若存在多组答案，输出扫描过程中最先找到的一组；无解时输出 -1 -1。重点检查重复值、负数、无解场景以及 O(n) 时间复杂度。"
		if err := tx.Model(&AssignmentRecord{}).Where("id = ? AND description = ?", assignment.ID, "实现 twoSum，返回目标和对应的两个不同下标。").Update("description", "读取整数数量 n、目标值 target 和 n 个整数，输出和为 target 的两个不同元素的零基下标；无解时输出 -1 -1。").Error; err != nil {
			return err
		}
		if err := tx.Model(&AssignmentRecord{}).Where("id = ? AND (reference_solution = '' OR reference_solution IS NULL)", assignment.ID).Update("reference_solution", referenceSolution).Error; err != nil {
			return err
		}
		if err := tx.Model(&AssignmentRecord{}).Where("id = ? AND (knowledge_base = '' OR knowledge_base IS NULL)", assignment.ID).Update("knowledge_base", knowledgeBase).Error; err != nil {
			return err
		}
		tests := []TestCaseRecord{
			{AssignmentID: assignment.ID, Name: "基础用例", Input: "4 9\n2 7 11 15\n", Expected: "0 1\n", Hidden: false, Weight: 3, TimeoutMS: 2000},
			{AssignmentID: assignment.ID, Name: "重复元素", Input: "3 6\n3 3 8\n", Expected: "0 1\n", Hidden: false, Weight: 2, TimeoutMS: 2000},
			{AssignmentID: assignment.ID, Name: "负数与零", Input: "5 -3\n0 -5 2 -3 8\n", Expected: "1 2\n", Hidden: true, Weight: 3, TimeoutMS: 2000},
			{AssignmentID: assignment.ID, Name: "无解场景", Input: "4 100\n1 2 3 4\n", Expected: "-1 -1\n", Hidden: true, Weight: 2, TimeoutMS: 2000},
		}
		for _, test := range tests {
			if err := tx.Where("assignment_id = ? AND name = ?", assignment.ID, test.Name).FirstOrCreate(&test).Error; err != nil {
				return err
			}
		}

		evaluation, _ := json.Marshal(domain.Evaluation{Total: 92, MaxTotal: 100, Status: "graded", Provider: "rules", Summary: "示例提交使用哈希表完成单次遍历，能够处理常见输入和无解场景。", Strengths: []string{"使用哈希表一次遍历，结构简洁。"}, Issues: []string{"输入异常时缺少显式错误处理。"}, Improvements: []string{"补充输入校验和关键步骤注释。"}, ReviewedAt: time.Now(), Confidence: 1, Verified: true, EvidenceType: "sandbox+static", PromptVersion: "seed-v1", EvaluatorVersion: "seed-v1", ModelCalls: 0, Analysis: []domain.AnalysisFinding{
			{Category: "algorithm", Severity: "info", Location: "main", Evidence: "seen[target-value]", Explanation: "通过哈希表将查找补数降为常数时间。"},
		}, Execution: &domain.ExecutionEvidence{Language: "Go", CompileOK: true, Passed: 4, Total: 4, PassedWeight: 10, TotalWeight: 10, Results: []domain.TestResult{
			{Name: "基础用例", Passed: true, ExitCode: 0, DurationMS: 8},
			{Name: "重复元素", Passed: true, ExitCode: 0, DurationMS: 7},
			{Name: "负数与零", Passed: true, Hidden: true, ExitCode: 0, DurationMS: 7},
			{Name: "无解场景", Passed: true, Hidden: true, ExitCode: 0, DurationMS: 6},
		}}, Dimensions: []domain.DimensionScore{
			{Key: "correctness", Name: "功能正确性", Score: 45, MaxScore: 45, Evidence: "示例测试全部通过。", Suggestion: "保持。"},
			{Key: "robustness", Name: "鲁棒性", Score: 18, MaxScore: 20, Evidence: "无解时按约定输出 -1 -1。", Suggestion: "可进一步校验输入格式。"},
			{Key: "quality", Name: "代码质量", Score: 16, MaxScore: 20, Evidence: "职责明确，缺少函数注释。", Suggestion: "补充接口注释。"},
			{Key: "efficiency", Name: "算法效率", Score: 13, MaxScore: 15, Evidence: "使用哈希表一次遍历。", Suggestion: "注明空间复杂度 O(n)。"},
		}})
		submission := SubmissionRecord{AssignmentID: assignment.ID, StudentID: student.ID, Code: referenceSolution, Status: "graded", Progress: 100, EvaluationJSON: evaluation, SubmittedAt: time.Now().Add(-2 * time.Hour)}
		if err := tx.Where("assignment_id = ? AND student_id = ?", assignment.ID, student.ID).FirstOrCreate(&submission).Error; err != nil {
			return err
		}
		return tx.Model(&SubmissionRecord{}).Where("id = ?", submission.ID).Updates(map[string]any{"code": referenceSolution, "status": "graded", "progress": 100, "evaluation_json": evaluation}).Error
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
