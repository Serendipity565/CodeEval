package store

import (
	"database/sql/driver"
	"errors"
	"testing"
	"time"

	"codeeval/server/internal/domain"
	"gorm.io/gorm"
)

func TestEnrollmentIsIdempotentAndRequiresExistingCourse(t *testing.T) {
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"},
		{kind: "query", contains: []string{"FROM `course_records`"}, columns: []string{"id"}, rows: [][]driver.Value{{int64(9)}}},
		{kind: "exec", contains: []string{"INSERT INTO `enrollment_records`", "ON DUPLICATE KEY UPDATE"}},
		{kind: "commit"},
		{kind: "begin"},
		{kind: "query", contains: []string{"FROM `course_records`"}, columns: []string{"id"}, rows: [][]driver.Value{{int64(9)}}},
		{kind: "exec", contains: []string{"INSERT INTO `enrollment_records`", "ON DUPLICATE KEY UPDATE"}},
		{kind: "commit"},
		{kind: "begin"},
		{kind: "query", contains: []string{"FROM `course_records`"}, columns: []string{"id"}},
		{kind: "rollback"},
	})
	if err := s.Enroll(9, 3); err != nil {
		t.Fatal(err)
	}
	if err := s.Enroll(9, 3); err != nil {
		t.Fatal(err)
	}
	if err := s.Enroll(99, 3); !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("missing course accepted: %v", err)
	}
}
func TestAssignmentVisibilityIsScopedToEnrollmentOrOwner(t *testing.T) {
	for _, role := range []string{"student", "teacher"} {
		t.Run(role, func(t *testing.T) {
			scope := []string{"FROM `assignment_records`"}
			if role == "student" {
				scope = append(scope, "course_id IN (SELECT `course_id` FROM `enrollment_records` WHERE student_id = ?)")
			} else {
				scope = append(scope, "teacher_id = ?")
			}
			s := assessmentTestStore(t, []assessmentStep{{kind: "query", contains: scope, columns: []string{"id"}, check: func(args []driver.NamedValue) {
				if len(args) != 1 || args[0].Value != int64(3) {
					t.Fatalf("wrong scope: %+v", args)
				}
			}}})
			rows, err := s.AssignmentsFor(3, role)
			if err != nil || len(rows) != 0 || rows == nil {
				t.Fatalf("scoped list: %v %v", rows, err)
			}
		})
	}
}
func TestProgressCountsDistinctEnrolledStudentsAndHandlesEmptyCourse(t *testing.T) {
	for _, expected := range []int64{0, 3} {
		t.Run(string(rune('0'+expected)), func(t *testing.T) {
			submitted := int64(0)
			if expected > 0 {
				submitted = 2
			}
			s := assessmentTestStore(t, []assessmentStep{
				{kind: "query", contains: []string{"course_records c", "JOIN users"}, columns: []string{"title", "teacher_name"}, rows: [][]driver.Value{{"编程课程", "张老师"}}},
				{kind: "query", contains: []string{"enrollment_records", "course_id = ?"}, columns: []string{"count"}, rows: [][]driver.Value{{expected}}},
				{kind: "query", contains: []string{"COUNT(DISTINCT", "s.student_id", "JOIN enrollment_records e ON e.student_id=s.student_id AND e.course_id=?", "s.assignment_id = ?"}, columns: []string{"count"}, rows: [][]driver.Value{{submitted}}},
			})
			a := domain.Assignment{ID: "8", CourseID: "9"}
			if err := s.PopulateAssignmentCourse(&a); err != nil {
				t.Fatal(err)
			}
			if a.ExpectedStudents != expected || a.SubmittedStudents != submitted || a.CourseTitle != "编程课程" {
				t.Fatalf("incorrect progress: %+v", a)
			}
			if expected == 0 && a.SubmissionRate != nil {
				t.Fatalf("empty course has a rate: %v", *a.SubmissionRate)
			}
			if expected > 0 && (a.SubmissionRate == nil || *a.SubmissionRate < 66.66 || *a.SubmissionRate > 66.67) {
				t.Fatalf("wrong rate: %+v", a.SubmissionRate)
			}
		})
	}
}
func TestRosterUsesLatestSubmissionAndIncludesNonSubmitters(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "query", contains: []string{"FROM `assignment_records`", "id = ? AND teacher_id = ?"}, columns: []string{"id", "course_id"}, rows: [][]driver.Value{{int64(8), int64(9)}}},
		{kind: "query", contains: []string{"LEFT JOIN submission_records", "latest.assignment_id=? AND latest.student_id=e.student_id", "ORDER BY latest.submitted_at DESC, latest.id DESC LIMIT 1", "e.course_id = ?"}, columns: []string{"id", "name", "submission_id", "submitted_at"}, rows: [][]driver.Value{{int64(3), "学生甲", "12", now}, {int64(4), "学生乙", "", nil}}},
	})
	rows, err := s.AssignmentStudents(8, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 2 || rows[0].SubmissionID != "12" || rows[0].SubmittedAt == nil || rows[1].SubmissionID != "" || rows[1].SubmittedAt != nil {
		t.Fatalf("incorrect roster: %+v", rows)
	}
}
func TestLegacyMigrationPreservesAssignmentsAndEnrollsSubmitters(t *testing.T) {
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"},
		{kind: "exec", contains: []string{"UPDATE `course_records`", "WHERE title = ? AND description = ?"}},
		{kind: "query", contains: []string{"course_id = 0", "FOR UPDATE"}, columns: []string{"id", "teacher_id"}, rows: [][]driver.Value{{int64(8), int64(7)}, {int64(10), int64(7)}}},
		{kind: "exec", contains: []string{"INSERT INTO `course_records`"}, insertID: 9, check: func(args []driver.NamedValue) {
			found := false
			for _, arg := range args {
				if arg.Value == defaultPracticeCourseTitle {
					found = true
				}
				if arg.Value == previousDefaultCourseTitle {
					t.Fatal("ambiguous default course name is still inserted")
				}
			}
			if !found {
				t.Fatal("practice course name missing")
			}
		}},
		{kind: "exec", contains: []string{"UPDATE `assignment_records` SET `course_id`=?"}},
		{kind: "query", contains: []string{"SELECT DISTINCT `student_id`", "assignment_id = ?"}, columns: []string{"student_id"}, rows: [][]driver.Value{{int64(3)}}},
		{kind: "exec", contains: []string{"INSERT INTO `enrollment_records`", "ON DUPLICATE KEY UPDATE"}},
		{kind: "exec", contains: []string{"UPDATE `assignment_records` SET `course_id`=?"}},
		{kind: "query", contains: []string{"SELECT DISTINCT `student_id`"}, columns: []string{"student_id"}, rows: [][]driver.Value{{int64(3)}}},
		{kind: "exec", contains: []string{"INSERT INTO `enrollment_records`", "ON DUPLICATE KEY UPDATE"}},
		{kind: "commit"},
		{kind: "begin"},
		{kind: "exec", contains: []string{"UPDATE `course_records`", "WHERE title = ? AND description = ?"}},
		{kind: "query", contains: []string{"course_id = 0", "FOR UPDATE"}, columns: []string{"id", "teacher_id"}},
		{kind: "commit"},
	})
	if err := s.MigrateLegacyCourses(); err != nil {
		t.Fatal(err)
	}
	if err := s.MigrateLegacyCourses(); err != nil {
		t.Fatal(err)
	}
}

func TestEnrollmentMembershipIsSpecificToStudentAndCourse(t *testing.T) {
	for _, count := range []int64{0, 1} {
		s := assessmentTestStore(t, []assessmentStep{{kind: "query", contains: []string{"FROM `enrollment_records`", "course_id = ? AND student_id = ?"}, columns: []string{"count"}, rows: [][]driver.Value{{count}}, check: func(args []driver.NamedValue) {
			if len(args) != 2 || args[0].Value != int64(9) || args[1].Value != int64(3) {
				t.Fatalf("incorrect membership scope: %+v", args)
			}
		}}})
		ok, err := s.Enrolled(9, 3)
		if err != nil || ok != (count > 0) {
			t.Fatalf("membership count %d: ok=%v err=%v", count, ok, err)
		}
	}
}

func TestCourseRosterIncludesStudentsWithoutAssignmentsOrSubmissions(t *testing.T) {
	now := time.Now().Truncate(time.Second)
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "query", contains: []string{"FROM `course_records`", "id = ? AND teacher_id = ?"}, columns: []string{"count"}, rows: [][]driver.Value{{int64(1)}}, check: func(args []driver.NamedValue) {
			if len(args) != 2 || args[0].Value != int64(9) || args[1].Value != int64(7) {
				t.Fatalf("incorrect ownership scope: %+v", args)
			}
		}},
		{kind: "query", contains: []string{"FROM enrollment_records e", "JOIN users u ON u.id=e.student_id", "u.username", "e.created_at AS enrolled_at", "e.course_id = ?", "ORDER BY e.created_at DESC, u.id ASC"}, columns: []string{"id", "name", "username", "enrolled_at"}, rows: [][]driver.Value{{int64(3), "同名学生", "student03", now}, {int64(4), "同名学生", "student04", now}}, check: func(args []driver.NamedValue) {
			if len(args) != 1 || args[0].Value != int64(9) {
				t.Fatalf("incorrect roster scope: %+v", args)
			}
		}},
	})
	students, err := s.CourseStudents(9, 7)
	if err != nil {
		t.Fatal(err)
	}
	if len(students) != 2 || students[0].ID != "3" || students[0].Name != "同名学生" || students[0].Username != "student03" || !students[0].EnrolledAt.Equal(now) || students[1].Username != "student04" {
		t.Fatalf("incorrect course roster: %+v", students)
	}
}
func TestCourseRosterDoesNotExposeAnotherTeachersStudents(t *testing.T) {
	s := assessmentTestStore(t, []assessmentStep{{kind: "query", contains: []string{"FROM `course_records`", "id = ? AND teacher_id = ?"}, columns: []string{"count"}, rows: [][]driver.Value{{int64(0)}}}})
	_, err := s.CourseStudents(9, 8)
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("foreign or missing course accepted: %v", err)
	}
}
func TestEmptyCourseRosterReturnsAnArray(t *testing.T) {
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "query", contains: []string{"FROM `course_records`"}, columns: []string{"count"}, rows: [][]driver.Value{{int64(1)}}},
		{kind: "query", contains: []string{"FROM enrollment_records e"}, columns: []string{"id", "name", "username", "enrolled_at"}},
	})
	students, err := s.CourseStudents(9, 7)
	if err != nil || students == nil || len(students) != 0 {
		t.Fatalf("empty roster: %v, %v", students, err)
	}
}

func TestDefaultCourseRenameOnlyTargetsUneditedGeneratedMetadata(t *testing.T) {
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"},
		{kind: "exec", contains: []string{"UPDATE `course_records`", "WHERE title = ? AND description = ?"}, check: func(args []driver.NamedValue) {
			want := []string{defaultPracticeCourseDescription, defaultPracticeCourseTitle, previousDefaultCourseTitle, previousDefaultCourseDescription}
			if len(args) != len(want) {
				t.Fatalf("unexpected rename scope: %+v", args)
			}
			for i, value := range want {
				if args[i].Value != value {
					t.Fatalf("rename must preserve custom titles and descriptions: %+v", args)
				}
			}
		}},
		{kind: "query", contains: []string{"course_id = 0", "FOR UPDATE"}, columns: []string{"id", "teacher_id"}},
		{kind: "commit"},
	})
	if err := s.MigrateLegacyCourses(); err != nil {
		t.Fatal(err)
	}
}
