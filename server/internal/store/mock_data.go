package store

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

const mockPassword = "CodeEval123!"

//go:embed fixtures/recorded_seed.json
var recordedSeedJSON []byte

// SeedMockData restores actual browser-generated evaluation results, then adds
// illustrative courses and enrollments. It never invents grades or calls a model.
func SeedMockData(s *MySQLStore) error {
	snapshot, err := loadRecordedSeed()
	if err != nil {
		return err
	}
	if err := s.MigrateDemoTeacherUsername(); err != nil {
		return err
	}
	if err := SeedRecordedData(s, snapshot); err != nil {
		return err
	}
	return seedCourseDemoData(s, snapshot)
}

// MigrateDemoTeacherUsername preserves the original user ID, password and all
// relationships. An occupied target is a conflict, never a reason to merge users.
func (s *MySQLStore) MigrateDemoTeacherUsername() error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		var users []User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("username IN ?", []string{"teacher", "teacher01"}).Order("id ASC").Find(&users).Error; err != nil {
			return err
		}
		var previous, target *User
		for i := range users {
			if users[i].Username == "teacher" {
				previous = &users[i]
			}
			if users[i].Username == "teacher01" {
				target = &users[i]
			}
		}
		if previous == nil || previous.Role != "teacher" {
			return nil
		}
		if target != nil {
			return fmt.Errorf("cannot rename demo account teacher to teacher01: %w", ErrUsernameTaken)
		}
		return tx.Model(&User{}).Where("id = ? AND username = ? AND role = ?", previous.ID, "teacher", "teacher").Update("username", "teacher01").Error
	})
}

func loadRecordedSeed() (RecordedSeed, error) {
	var snapshot RecordedSeed
	if err := json.Unmarshal(recordedSeedJSON, &snapshot); err != nil {
		return snapshot, err
	}
	return snapshot, ValidateRecordedSeed(snapshot)
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
