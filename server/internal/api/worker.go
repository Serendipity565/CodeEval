package api

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"time"

	"codeeval/server/internal/store"
	"gorm.io/gorm"
)

// StartEvaluationWorkers starts a fixed-size worker pool. The number of
// goroutines is the hard per-process concurrency ceiling for future Docker
// sandboxes as well as the current analysis pipeline.
func (h *Handler) StartEvaluationWorkers(ctx context.Context) error {
	if err := h.store.BackfillPendingEvaluationJobs(); err != nil {
		return fmt.Errorf("backfill pending evaluation jobs: %w", err)
	}
	if err := h.store.RequeueStaleJobs(time.Now().Add(-2 * h.jobTimeout)); err != nil {
		return fmt.Errorf("requeue stale evaluation jobs: %w", err)
	}
	if err := h.store.FailExhaustedEvaluationJobs(h.maxAttempts); err != nil {
		return fmt.Errorf("fail exhausted evaluation jobs: %w", err)
	}
	hostname, _ := os.Hostname()
	for index := 0; index < h.maxWorkers; index++ {
		workerID := fmt.Sprintf("%s-%d-%d", hostname, os.Getpid(), index+1)
		go h.evaluationWorker(ctx, workerID)
	}
	go h.staleJobReaper(ctx)
	log.Printf("evaluation worker pool started: concurrency=%d poll=%s timeout=%s attempts=%d", h.maxWorkers, h.pollInterval, h.jobTimeout, h.maxAttempts)
	return nil
}

func (h *Handler) staleJobReaper(ctx context.Context) {
	interval := h.jobTimeout
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := h.store.RequeueStaleJobs(time.Now().Add(-2 * h.jobTimeout)); err != nil {
				log.Printf("failed to requeue stale evaluation jobs: %v", err)
			}
			if err := h.store.FailExhaustedEvaluationJobs(h.maxAttempts); err != nil {
				log.Printf("failed to mark exhausted evaluation jobs: %v", err)
			}
		}
	}
}

func (h *Handler) evaluationWorker(ctx context.Context, workerID string) {
	for {
		if ctx.Err() != nil {
			return
		}
		job, err := h.store.ClaimEvaluationJob(workerID, h.maxAttempts)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			if !waitForNextPoll(ctx, h.pollInterval) {
				return
			}
			continue
		}
		if err != nil {
			log.Printf("evaluation worker %s failed to claim job: %v", workerID, err)
			if !waitForNextPoll(ctx, h.pollInterval) {
				return
			}
			continue
		}
		h.processEvaluationJob(ctx, job)
	}
}

func (h *Handler) processEvaluationJob(parent context.Context, job store.EvaluationJob) {
	jobCtx, cancel := context.WithTimeout(parent, h.jobTimeout)
	defer cancel()
	if err := h.store.UpdateSubmissionProgress(job.SubmissionID, "evaluating", 35); err != nil {
		_ = h.store.FailEvaluationJob(job, h.maxAttempts, err)
		return
	}
	assignment, submission, history, err := h.store.EvaluationJobPayload(job)
	if err == nil {
		var evaluationErr error
		evaluation, evaluationErr := h.evaluator.Evaluate(jobCtx, assignment, submission.Code, history)
		if evaluationErr == nil {
			if completeErr := h.store.CompleteEvaluationJob(job.ID, job.SubmissionID, evaluation); completeErr == nil {
				return
			} else {
				err = completeErr
			}
		} else {
			err = evaluationErr
		}
	}
	log.Printf("evaluation job %d attempt %d failed: %v", job.ID, job.Attempts, err)
	_ = h.store.FailEvaluationJob(job, h.maxAttempts, err)
}

func waitForNextPoll(ctx context.Context, interval time.Duration) bool {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
