package store

import (
	"database/sql/driver"
	"strings"
	"testing"
)

// The script rejects any unexpected writes, including regenerated grades,
// changed passwords, renamed existing courses or rewritten enrollment times.
func courseDemoSeedSteps(t *testing.T, snapshot RecordedSeed, existing bool) []assessmentStep {
	t.Helper()
	steps := []assessmentStep{{kind: "begin"}}
	cohort := append(append([]RecordedSeedUser(nil), snapshot.Users...), courseDemoUsers...)
	ids := map[string]int64{}
	for i, user := range cohort {
		ids[user.Username] = int64(100 + i)
		query := assessmentStep{kind: "query", contains: []string{"FROM `users`", "username = ?"}, columns: []string{"id", "role"}}
		if i < len(snapshot.Users) || existing {
			query.rows = [][]driver.Value{{int64(100 + i), user.Role}}
		}
		steps = append(steps, query)
		if i >= len(snapshot.Users) && !existing {
			steps = append(steps, assessmentStep{kind: "exec", contains: []string{"INSERT INTO `users`"}, insertID: int64(100 + i)})
		}
	}
	primaryID := int64(500)
	assignmentQuery := assessmentStep{kind: "query", contains: []string{"FROM `assignment_records`", "teacher_id = ? AND title = ? AND language = ?", "FOR UPDATE"}, columns: []string{"id", "course_id"}, rows: [][]driver.Value{{int64(200), int64(0)}}}
	if existing {
		primaryID = 700
		assignmentQuery.rows = [][]driver.Value{{int64(200), primaryID}}
	}
	steps = append(steps, assignmentQuery)
	if existing {
		steps = append(steps, assessmentStep{kind: "query", contains: []string{"FROM `course_records`", "id = ? AND teacher_id = ?"}, columns: []string{"id", "title", "description"}, rows: [][]driver.Value{{primaryID, "教师保留的课程名称", "已修改的课程说明"}}, check: func(args []driver.NamedValue) {
			if len(args) < 2 || args[0].Value != primaryID || args[1].Value != ids[snapshot.Assignment.Teacher] {
				t.Fatalf("existing course ownership not checked: %+v", args)
			}
		}})
	} else {
		steps = append(steps,
			assessmentStep{kind: "query", contains: []string{"FROM `course_records`", "teacher_id = ? AND title = ?"}, columns: []string{"id"}},
			assessmentStep{kind: "exec", contains: []string{"INSERT INTO `course_records`"}, insertID: primaryID},
			assessmentStep{kind: "exec", contains: []string{"UPDATE `assignment_records` SET `course_id`=?"}, check: func(args []driver.NamedValue) {
				if len(args) != 2 || args[0].Value != primaryID || args[1].Value != int64(200) {
					t.Fatalf("wrong assignment binding: %+v", args)
				}
			}},
		)
	}
	enrollment := func(courseID, studentID int64) assessmentStep {
		return assessmentStep{kind: "exec", contains: []string{"INSERT INTO `enrollment_records`", "ON DUPLICATE KEY UPDATE"}, check: func(args []driver.NamedValue) {
			if len(args) < 2 || args[0].Value != courseID || args[1].Value != studentID {
				t.Fatalf("wrong enrollment mapping: %+v, want %d/%d", args, courseID, studentID)
			}
		}}
	}
	for _, user := range cohort {
		if user.Role == "student" {
			steps = append(steps, enrollment(primaryID, ids[user.Username]))
		}
	}
	for _, course := range []struct {
		id, teacherID int64
		title         string
		students      []string
	}{
		{501, ids[snapshot.Assignment.Teacher], "数据结构与算法", []string{"student01", "student02", "student07"}},
		{502, ids["teacher02"], "Python 程序设计", nil},
	} {
		course := course
		query := assessmentStep{kind: "query", contains: []string{"FROM `course_records`", "teacher_id = ? AND title = ?"}, columns: []string{"id"}, check: func(args []driver.NamedValue) {
			if len(args) < 2 || args[0].Value != course.teacherID || args[1].Value != course.title {
				t.Fatalf("wrong demo course: %+v", args)
			}
		}}
		if existing {
			query.rows = [][]driver.Value{{course.id}}
		}
		steps = append(steps, query)
		if !existing {
			steps = append(steps, assessmentStep{kind: "exec", contains: []string{"INSERT INTO `course_records`"}, insertID: course.id})
		}
		for _, student := range course.students {
			steps = append(steps, enrollment(course.id, ids[student]))
		}
	}
	return append(steps, assessmentStep{kind: "commit"})
}

func TestCourseDemoSeedPreservesExistingCourseAndAssignment(t *testing.T) {
	snapshot, err := loadRecordedSeed()
	if err != nil {
		t.Fatal(err)
	}
	if err := seedCourseDemoData(assessmentTestStore(t, courseDemoSeedSteps(t, snapshot, true)), snapshot); err != nil {
		t.Fatal(err)
	}
}
func TestCourseDemoSeedRejectsConflictingRolesBeforeCreatingCourses(t *testing.T) {
	snapshot, err := loadRecordedSeed()
	if err != nil {
		t.Fatal(err)
	}
	steps := []assessmentStep{{kind: "begin"}}
	for i, user := range append(append([]RecordedSeedUser(nil), snapshot.Users...), courseDemoUsers...) {
		role := user.Role
		if user.Username == "student07" {
			role = "teacher"
		}
		steps = append(steps, assessmentStep{kind: "query", contains: []string{"FROM `users`"}, columns: []string{"id", "role"}, rows: [][]driver.Value{{int64(100 + i), role}}})
		if user.Username == "student07" {
			break
		}
	}
	steps = append(steps, assessmentStep{kind: "rollback"})
	err = seedCourseDemoData(assessmentTestStore(t, steps), snapshot)
	if err == nil || !strings.Contains(err.Error(), "student07") {
		t.Fatalf("role collision was not rejected: %v", err)
	}
}
