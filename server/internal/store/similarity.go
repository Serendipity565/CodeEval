package store

import (
	"codeeval/server/internal/domain"
	"context"
)

// SimilaritySubmissions checks assignment ownership before loading any source.
// Batch mode selects the latest submission of each student in SQL, so earlier
// versions cannot cause comparisons between one student's own attempts.
func (s *MySQLStore) SimilaritySubmissions(ctx context.Context, assignmentID, teacherID uint, ids []string) ([]domain.Submission, error) {
	db := s.db.WithContext(ctx)
	var assignment AssignmentRecord
	if err := db.Select("id").Where("id = ? AND teacher_id = ?", assignmentID, teacherID).First(&assignment).Error; err != nil {
		return nil, err
	}
	query := db.Model(&SubmissionRecord{}).Select("id", "assignment_id", "student_id", "code", "submitted_at").Where("assignment_id = ?", assignmentID)
	if len(ids) > 0 {
		query = query.Where("id IN ?", ids)
	} else {
		query = query.Where("NOT EXISTS (SELECT 1 FROM submission_records AS newer WHERE newer.assignment_id = submission_records.assignment_id AND newer.student_id = submission_records.student_id AND (newer.submitted_at > submission_records.submitted_at OR (newer.submitted_at = submission_records.submitted_at AND newer.id > submission_records.id)))")
	}
	var rows []SubmissionRecord
	if err := query.Order("student_id asc, id asc").Limit(domain.SimilarityMaxSubmissions + 1).Find(&rows).Error; err != nil {
		return nil, err
	}
	if len(rows) > domain.SimilarityMaxSubmissions {
		return nil, domain.ErrSimilarityLimit
	}
	return submissionsWithNames(db, rows)
}
