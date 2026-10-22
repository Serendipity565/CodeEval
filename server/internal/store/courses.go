package store

import (
	"fmt"
	"time"

	"codeeval/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type CourseRecord struct {
	ID          uint   `gorm:"primaryKey"`
	TeacherID   uint   `gorm:"index;not null"`
	Title       string `gorm:"size:200;not null"`
	Description string `gorm:"type:text"`
	CreatedAt   time.Time
}
type EnrollmentRecord struct {
	CourseID  uint `gorm:"primaryKey;autoIncrement:false"`
	StudentID uint `gorm:"primaryKey;autoIncrement:false;index"`
	CreatedAt time.Time
}

const defaultPracticeCourseTitle = "编程实践"
const defaultPracticeCourseDescription = "通过编程练习掌握程序设计方法、算法实现与问题求解。"

const previousDefaultCourseTitle = "历史作业课程"
const previousDefaultCourseDescription = "由已有作业迁移生成，原有提交记录已保留。"

func (s *MySQLStore) MigrateLegacyCourses() error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		// Only replace untouched defaults from the previous migration. Preserve
		// course IDs, enrollments, assignments and any teacher-edited metadata.
		if err := tx.Model(&CourseRecord{}).
			Where("title = ? AND description = ?", previousDefaultCourseTitle, previousDefaultCourseDescription).
			Updates(map[string]any{"title": defaultPracticeCourseTitle, "description": defaultPracticeCourseDescription}).Error; err != nil {
			return err
		}
		var assignments []AssignmentRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("course_id = 0").Find(&assignments).Error; err != nil {
			return err
		}
		courses := map[uint]uint{}
		for _, a := range assignments {
			courseID := courses[a.TeacherID]
			if courseID == 0 {
				course := CourseRecord{TeacherID: a.TeacherID, Title: defaultPracticeCourseTitle, Description: defaultPracticeCourseDescription}
				if err := tx.Create(&course).Error; err != nil {
					return err
				}
				courseID = course.ID
				courses[a.TeacherID] = courseID
			}
			if err := tx.Model(&a).Update("course_id", courseID).Error; err != nil {
				return err
			}
			var students []uint
			if err := tx.Model(&SubmissionRecord{}).Where("assignment_id = ?", a.ID).Distinct("student_id").Pluck("student_id", &students).Error; err != nil {
				return err
			}
			for _, studentID := range students {
				if err := tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&EnrollmentRecord{CourseID: courseID, StudentID: studentID}).Error; err != nil {
					return err
				}
			}
		}
		return nil
	})
}
func (s *MySQLStore) CreateCourse(teacherID uint, title, description string) (domain.Course, error) {
	row := CourseRecord{TeacherID: teacherID, Title: title, Description: description}
	err := s.db.Create(&row).Error
	return domain.Course{ID: fmt.Sprint(row.ID), TeacherID: fmt.Sprint(teacherID), Title: title, Description: description}, err
}
func (s *MySQLStore) ListCourses(userID uint, role string) ([]domain.Course, error) {
	out := make([]domain.Course, 0)
	q := s.db.Table("course_records c").Select(`c.id, c.teacher_id, c.title, c.description, u.display_name AS teacher_name,
 (SELECT COUNT(*) FROM enrollment_records e WHERE e.course_id=c.id) AS student_count,
 (SELECT COUNT(*) FROM assignment_records a WHERE a.course_id=c.id) AS assignment_count,
 EXISTS(SELECT 1 FROM enrollment_records e WHERE e.course_id=c.id AND e.student_id=?) AS enrolled`, userID).Joins("JOIN users u ON u.id=c.teacher_id").Order("c.id DESC")
	if role == "teacher" {
		q = q.Where("c.teacher_id = ?", userID)
	}
	err := q.Scan(&out).Error
	return out, err
}
func (s *MySQLStore) OwnsCourse(courseID, teacherID uint) (bool, error) {
	var count int64
	err := s.db.Model(&CourseRecord{}).Where("id = ? AND teacher_id = ?", courseID, teacherID).Count(&count).Error
	return count > 0, err
}
func (s *MySQLStore) Enrolled(courseID, studentID uint) (bool, error) {
	var count int64
	err := s.db.Model(&EnrollmentRecord{}).Where("course_id = ? AND student_id = ?", courseID, studentID).Count(&count).Error
	return count > 0, err
}
func (s *MySQLStore) Enroll(courseID, studentID uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var course CourseRecord
		if err := tx.First(&course, courseID).Error; err != nil {
			return err
		}
		return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&EnrollmentRecord{CourseID: courseID, StudentID: studentID}).Error
	})
}

// Scope assignment visibility at the query, then compute distinct enrolled submitters.
func (s *MySQLStore) AssignmentsFor(userID uint, role string) ([]domain.Assignment, error) {
	var rows []AssignmentRecord
	q := s.db.Order("due_at asc")
	if role == "teacher" {
		q = q.Where("teacher_id = ?", userID)
	} else {
		q = q.Where("course_id IN (?)", s.db.Model(&EnrollmentRecord{}).Select("course_id").Where("student_id = ?", userID))
	}
	if err := q.Find(&rows).Error; err != nil {
		return nil, err
	}
	out := make([]domain.Assignment, 0, len(rows))
	for _, row := range rows {
		a := assignmentFrom(row)
		if err := s.PopulateAssignmentCourse(&a); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, nil
}
func (s *MySQLStore) PopulateAssignmentCourse(a *domain.Assignment) error {
	var meta struct{ Title, TeacherName string }
	if err := s.db.Table("course_records c").Select("c.title, u.display_name AS teacher_name").Joins("JOIN users u ON u.id=c.teacher_id").Where("c.id = ?", mustID(a.CourseID)).Scan(&meta).Error; err != nil {
		return err
	}
	a.CourseTitle = meta.Title
	a.TeacherName = meta.TeacherName
	if err := s.db.Model(&EnrollmentRecord{}).Where("course_id = ?", mustID(a.CourseID)).Count(&a.ExpectedStudents).Error; err != nil {
		return err
	}
	if err := s.db.Table("submission_records s").Joins("JOIN enrollment_records e ON e.student_id=s.student_id AND e.course_id=?", mustID(a.CourseID)).Where("s.assignment_id = ?", mustID(a.ID)).Distinct("s.student_id").Count(&a.SubmittedStudents).Error; err != nil {
		return err
	}
	if a.ExpectedStudents > 0 {
		rate := float64(a.SubmittedStudents) * 100 / float64(a.ExpectedStudents)
		a.SubmissionRate = &rate
	}
	return nil
}
func (s *MySQLStore) AssignmentStudents(assignmentID, teacherID uint) ([]domain.AssignmentStudent, error) {
	var a AssignmentRecord
	if err := s.db.Where("id = ? AND teacher_id = ?", assignmentID, teacherID).First(&a).Error; err != nil {
		return nil, err
	}
	out := make([]domain.AssignmentStudent, 0)
	err := s.db.Table("enrollment_records e").Select(`u.id, u.display_name AS name, COALESCE(CAST(s.id AS CHAR), '') AS submission_id, s.submitted_at`).Joins("JOIN users u ON u.id=e.student_id").Joins(`LEFT JOIN submission_records s ON s.id=(SELECT latest.id FROM submission_records latest WHERE latest.assignment_id=? AND latest.student_id=e.student_id ORDER BY latest.submitted_at DESC, latest.id DESC LIMIT 1)`, assignmentID).Where("e.course_id = ?", a.CourseID).Order("u.display_name, u.id").Scan(&out).Error
	return out, err
}

// CourseStudents includes every enrollment, regardless of assignments or submissions.
func (s *MySQLStore) CourseStudents(courseID, teacherID uint) ([]domain.CourseStudent, error) {
	owns, err := s.OwnsCourse(courseID, teacherID)
	if err != nil {
		return nil, err
	}
	if !owns {
		return nil, gorm.ErrRecordNotFound
	}
	students := make([]domain.CourseStudent, 0)
	err = s.db.Table("enrollment_records e").
		Select("u.id, u.display_name AS name, u.username, e.created_at AS enrolled_at").
		Joins("JOIN users u ON u.id=e.student_id").
		Where("e.course_id = ?", courseID).
		Order("e.created_at DESC, u.id ASC").Scan(&students).Error
	return students, err
}
