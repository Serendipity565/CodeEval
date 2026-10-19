package domain

import "time"

// SubmissionDeadlinePassed treats the deadline itself as closed for submissions.
func SubmissionDeadlinePassed(dueAt, now time.Time) bool {
	return !now.Before(dueAt)
}
