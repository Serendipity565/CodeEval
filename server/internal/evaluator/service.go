package evaluator

import (
	"context"
	"fmt"

	"codeeval/server/internal/config"
	"codeeval/server/internal/domain"
)

type Service struct {
	deepseek     *DeepSeekClient
	maxCodeBytes int
}

func NewService(cfg config.Config) *Service {
	return &Service{
		deepseek:     NewDeepSeekClient(cfg.DeepSeek.BaseURL, cfg.DeepSeek.APIKey, cfg.DeepSeek.Model, cfg.DeepSeek.TimeoutSecs, cfg.DeepSeek.MaxTokens),
		maxCodeBytes: cfg.DeepSeek.MaxCodeBytes,
	}
}

func (s *Service) Evaluate(ctx context.Context, assignment domain.Assignment, code string, history []domain.Submission) (domain.Evaluation, error) {
	if !assignment.LLMEvaluationEnabled {
		result := Evaluate(code, assignment.Rubric)
		result.Provider = "rules"
		return result, nil
	}
	if s.deepseek.APIKeyMissing() {
		return domain.Evaluation{}, fmt.Errorf("DeepSeek API key is not configured")
	}
	if len([]byte(code)) > s.maxCodeBytes {
		return domain.Evaluation{}, fmt.Errorf("code exceeds the %d byte LLM evaluation limit", s.maxCodeBytes)
	}
	return s.deepseek.Evaluate(ctx, assignment, code, history)
}
