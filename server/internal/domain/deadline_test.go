package domain

import (
	"testing"
	"time"
)

func TestSubmissionDeadlinePassed(t *testing.T) {
	due := time.Date(2026, 10, 17, 12, 0, 0, 0, time.FixedZone("UTC+8", 8*60*60))
	for _, test := range []struct {
		name     string
		due, now time.Time
		want     bool
	}{
		{"before deadline", due, due.Add(-time.Nanosecond), false},
		{"at deadline", due, due, true},
		{"after deadline", due, due.Add(time.Nanosecond), true},
		{"same instant in UTC", due, due.UTC(), true},
		{"before deadline in UTC", due, due.Add(-time.Second).UTC(), false},
		{"missing deadline", time.Time{}, due, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := SubmissionDeadlinePassed(test.due, test.now); got != test.want {
				t.Fatalf("SubmissionDeadlinePassed(%v, %v) = %v, want %v", test.due, test.now, got, test.want)
			}
		})
	}
}
