package store

import (
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// These accounts and course memberships are illustrative fixtures. They add no
// submissions or grades to the independently captured assessment snapshot.
var courseDemoUsers = []RecordedSeedUser{
	{Username: "student07", DisplayName: "周同学", Role: "student"},
	{Username: "student08", DisplayName: "吴同学", Role: "student"},
	{Username: "teacher02", DisplayName: "周老师", Role: "teacher"},
}

func seedCourseDemoData(s *MySQLStore, snapshot RecordedSeed) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		users := make(map[string]User)
		cohort := append(append([]RecordedSeedUser(nil), snapshot.Users...), courseDemoUsers...)
		for _, source := range cohort {
			user, err := ensureMockUser(tx, source.Username, source.DisplayName, source.Role)
			if err != nil {
				return err
			}
			if user.Role != source.Role {
				return fmt.Errorf("existing account %s has a different role", source.Username)
			}
			users[source.Username] = user
		}

		teacher := users[snapshot.Assignment.Teacher]
		// Lock the recorded assignment so concurrent startup cannot attach it to two
		// different courses. Preserve any course already chosen by the teacher.
		var assignment AssignmentRecord
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("teacher_id = ? AND title = ? AND language = ?", teacher.ID, snapshot.Assignment.Title, snapshot.Assignment.Language).First(&assignment).Error; err != nil {
			return err
		}
		primary := CourseRecord{TeacherID: teacher.ID, Title: "C++ 程序设计", Description: "学习 C++ 标准输入输出、数组与哈希表，通过编程练习培养算法实现与问题求解能力。"}
		if assignment.CourseID == 0 {
			if err := tx.Where("teacher_id = ? AND title = ?", teacher.ID, primary.Title).FirstOrCreate(&primary).Error; err != nil {
				return err
			}
			if err := tx.Model(&assignment).Update("course_id", primary.ID).Error; err != nil {
				return err
			}
		} else {
			if err := tx.Where("id = ? AND teacher_id = ?", assignment.CourseID, teacher.ID).First(&primary).Error; err != nil {
				return err
			}
		}
		enroll := func(courseID uint, username string) error {
			student, ok := users[username]
			if !ok || student.Role != "student" {
				return fmt.Errorf("invalid demo student %s", username)
			}
			return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&EnrollmentRecord{CourseID: courseID, StudentID: student.ID}).Error
		}
		for _, user := range cohort {
			if user.Role == "student" {
				if err := enroll(primary.ID, user.Username); err != nil {
					return err
				}
			}
		}

		structures := CourseRecord{TeacherID: teacher.ID, Title: "数据结构与算法", Description: "学习链表、栈、队列和树，理解常见数据结构及算法的实现与应用。"}
		if err := tx.Where("teacher_id = ? AND title = ?", structures.TeacherID, structures.Title).FirstOrCreate(&structures).Error; err != nil {
			return err
		}
		for _, username := range []string{"student01", "student02", "student07"} {
			if err := enroll(structures.ID, username); err != nil {
				return err
			}
		}

		python := CourseRecord{TeacherID: users["teacher02"].ID, Title: "Python 程序设计", Description: "学习 Python 基础语法、常用数据结构与数据处理，完成程序设计实践。"}
		return tx.Where("teacher_id = ? AND title = ?", python.TeacherID, python.Title).FirstOrCreate(&python).Error
	})
}
