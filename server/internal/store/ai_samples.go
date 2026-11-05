package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"time"

	"codeeval/server/internal/domain"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Content-addressed banks remain scoped to the authorized assignment. Reports
// keep their own snapshot, so assignment edits never rewrite old evidence.
type AISampleBankRecord struct {
	AssignmentID uint   `gorm:"primaryKey;autoIncrement:false"`
	Fingerprint  string `gorm:"primaryKey;size:64"`
	BankJSON     []byte `gorm:"type:json;not null"`
	CreatedAt    time.Time
}

func (AISampleBankRecord) TableName() string { return "ai_sample_banks" }

func (s *MySQLStore) LoadAISampleBank(ctx context.Context, assignmentID, fingerprint string) (*domain.AISampleBank, error) {
	id, err := strconv.ParseUint(assignmentID, 10, 64)
	if err != nil || id == 0 {
		return nil, fmt.Errorf("invalid sample bank assignment")
	}
	var row AISampleBankRecord
	err = s.db.WithContext(ctx).Where("assignment_id = ? AND fingerprint = ?", uint(id), fingerprint).First(&row).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var bank domain.AISampleBank
	if err := json.Unmarshal(row.BankJSON, &bank); err != nil {
		return nil, fmt.Errorf("decode AI sample bank: %w", err)
	}
	if bank.Fingerprint != fingerprint {
		return nil, fmt.Errorf("sample bank fingerprint mismatch")
	}
	return &bank, nil
}

func (s *MySQLStore) SaveAISampleBank(ctx context.Context, assignmentID string, bank domain.AISampleBank) error {
	id, err := strconv.ParseUint(assignmentID, 10, 64)
	if err != nil || id == 0 {
		return fmt.Errorf("invalid sample bank assignment")
	}
	data, err := json.Marshal(bank)
	if err != nil {
		return err
	}
	// Persist each completed sample, and never let a concurrent partial result
	// replace a more complete bank. JSON and count are bound parameters.
	return s.db.WithContext(ctx).Clauses(clause.OnConflict{DoUpdates: clause.Assignments(map[string]any{
		"bank_json": gorm.Expr("IF(JSON_LENGTH(bank_json, '$.samples') < ?, ?, bank_json)", len(bank.Samples), data),
	})}).Create(&AISampleBankRecord{AssignmentID: uint(id), Fingerprint: bank.Fingerprint, BankJSON: data}).Error
}
