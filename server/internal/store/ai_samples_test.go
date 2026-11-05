package store

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"reflect"
	"testing"
	"time"

	"codeeval/server/internal/domain"
)

func TestAISampleBankPersistAndLoadAreScopedToAssignmentAndFingerprint(t *testing.T) {
	bank := domain.AISampleBank{Fingerprint: "task-fingerprint", Model: "model", GeneratedAt: time.Date(2026, 11, 4, 12, 0, 0, 0, time.UTC), Samples: []domain.AISample{{ID: "ai-sample-1", Approach: "直接实现", Code: "print(1)"}}}
	encoded, _ := json.Marshal(bank)
	s := assessmentTestStore(t, []assessmentStep{
		{kind: "begin"},
		{kind: "exec", contains: []string{"INSERT INTO `ai_sample_banks`", "ON DUPLICATE KEY UPDATE"}, check: func(args []driver.NamedValue) {
			found := false
			for _, arg := range args {
				if b, ok := arg.Value.([]byte); ok {
					var saved domain.AISampleBank
					if json.Unmarshal(b, &saved) == nil && reflect.DeepEqual(saved, bank) {
						found = true
					}
				}
			}
			if !found {
				t.Fatal("incomplete sample bank JSON")
			}
		}},
		{kind: "commit"},
		{kind: "query", contains: []string{"FROM `ai_sample_banks`", "assignment_id = ? AND fingerprint = ?"}, columns: []string{"assignment_id", "fingerprint", "bank_json"}, rows: [][]driver.Value{{int64(2), bank.Fingerprint, encoded}}, check: func(args []driver.NamedValue) {
			if args[0].Value != int64(2) || args[1].Value != bank.Fingerprint {
				t.Fatal("sample bank crossed assignment/version boundary")
			}
		}},
	})
	if err := s.SaveAISampleBank(context.Background(), "2", bank); err != nil {
		t.Fatal(err)
	}
	loaded, err := s.LoadAISampleBank(context.Background(), "2", bank.Fingerprint)
	if err != nil || !reflect.DeepEqual(loaded, &bank) {
		t.Fatalf("sample snapshot lost: %+v %v", loaded, err)
	}
}

func TestAISampleBankMissingIsNotCorruption(t *testing.T) {
	for _, corrupt := range []bool{false, true} {
		step := assessmentStep{kind: "query", contains: []string{"assignment_id = ? AND fingerprint = ?"}, columns: []string{"bank_json"}}
		if corrupt {
			step.rows = [][]driver.Value{{[]byte("invalid JSON")}}
		}
		s := assessmentTestStore(t, []assessmentStep{step})
		bank, err := s.LoadAISampleBank(context.Background(), "2", "fingerprint")
		if corrupt && err == nil || !corrupt && (err != nil || bank != nil) {
			t.Fatalf("missing/corrupt bank mishandled: %+v %v", bank, err)
		}
	}
}
