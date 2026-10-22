package store

import (
	_ "embed"
	"encoding/json"
	"errors"

	"golang.org/x/crypto/bcrypt"
	"gorm.io/gorm"
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
	if err := SeedRecordedData(s, snapshot); err != nil {
		return err
	}
	return seedCourseDemoData(s, snapshot)
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
