package store

import (
	"sync"
	"time"

	"codeeval/server/internal/domain"
)

type MemoryStore struct {
	mu          sync.RWMutex
	assignment  domain.Assignment
	submissions []domain.Submission
}

func NewMemoryStore() *MemoryStore {
	return &MemoryStore{assignment: domain.Assignment{ID: "asgn-001", Title: "两数之和：返回下标", Language: "Go", Description: "实现 twoSum，返回目标和对应的两个不同下标。", DueAt: time.Now().Add(72 * time.Hour), Rubric: []domain.RubricItem{
		{Key: "correctness", Name: "功能正确性", Description: "通过公开与隐藏测试", Weight: 45}, {Key: "robustness", Name: "边界与鲁棒性", Description: "空输入、重复元素和异常边界", Weight: 20}, {Key: "quality", Name: "代码质量", Description: "命名、结构和可读性", Weight: 20}, {Key: "efficiency", Name: "算法效率", Description: "时间和空间复杂度", Weight: 15},
	}}, submissions: []domain.Submission{{ID: "sub-001", AssignmentID: "asgn-001", StudentName: "张同学", Status: "graded", SubmittedAt: time.Now().Add(-2 * time.Hour), Code: "func twoSum(nums []int, target int) []int {\n  seen := map[int]int{}\n  for i, n := range nums {\n    if j, ok := seen[target-n]; ok { return []int{j, i} }\n    seen[n] = i\n  }\n  return nil\n}", Evaluation: &domain.Evaluation{Total: 92, MaxTotal: 100, Status: "needs_review", Summary: "测试全部通过；实现清晰。建议补充函数注释，并说明无解时返回 nil 的约定。", ReviewedAt: time.Now().Add(-90 * time.Minute), Dimensions: []domain.DimensionScore{{Key: "correctness", Name: "功能正确性", Score: 45, MaxScore: 45, Evidence: "8/8 个测试通过，包括重复元素和负数。", Suggestion: "保持。"}, {Key: "robustness", Name: "边界与鲁棒性", Score: 18, MaxScore: 20, Evidence: "空切片和无解场景可安全返回 nil。", Suggestion: "在注释中写明返回约定。"}, {Key: "quality", Name: "代码质量", Score: 16, MaxScore: 20, Evidence: "单一职责明确；缺少文档注释。", Suggestion: "为 exported API 添加注释。"}, {Key: "efficiency", Name: "算法效率", Score: 13, MaxScore: 15, Evidence: "哈希表一次遍历，时间复杂度 O(n)。", Suggestion: "说明空间复杂度 O(n)。"}}}}}}
}
func (s *MemoryStore) Assignment() domain.Assignment {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.assignment
}
func (s *MemoryStore) Submissions() []domain.Submission {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]domain.Submission(nil), s.submissions...)
}
func (s *MemoryStore) Add(sub domain.Submission) domain.Submission {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.submissions = append([]domain.Submission{sub}, s.submissions...)
	return sub
}
