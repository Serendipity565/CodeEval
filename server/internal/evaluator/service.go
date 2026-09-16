package evaluator

import (
	"context"
	"fmt"
	"math"
	"strings"
	"time"

	"codeeval/server/internal/config"
	"codeeval/server/internal/domain"
	"codeeval/server/internal/sandbox"
)

type Service struct {
	deepseek     *DeepSeekClient
	maxCodeBytes int
	sandbox      *sandbox.Client
}

func applyExecutionEvidence(result *domain.Evaluation, assignment domain.Assignment, execution *domain.ExecutionEvidence) {
	if execution == nil {
		return
	}
	result.Execution = execution
	result.Verified = true
	for i := range result.Dimensions {
		item := assignment.Rubric[i]
		if !isFunctionalityCriterion(item) {
			continue
		}
		ratio := 0.0
		if execution.TotalWeight > 0 {
			ratio = float64(execution.PassedWeight) / float64(execution.TotalWeight)
		}
		result.Dimensions[i].Score = int(math.Round(float64(item.Weight) * ratio))
		result.Dimensions[i].Confidence = 1
		result.Dimensions[i].Verified = true
		result.Dimensions[i].EvidenceType = "execution"
		if !execution.CompileOK {
			result.Dimensions[i].Evidence = "沙箱编译失败：" + strings.TrimSpace(execution.CompileError)
		} else {
			result.Dimensions[i].Evidence = fmt.Sprintf("沙箱测试通过 %d/%d，按测试权重通过 %d/%d", execution.Passed, execution.Total, execution.PassedWeight, execution.TotalWeight)
		}
	}
	result.Total = 0
	confidence := 0.0
	for _, dimension := range result.Dimensions {
		result.Total += dimension.Score
		confidence += dimension.Confidence
	}
	if len(result.Dimensions) > 0 {
		result.Confidence = confidence / float64(len(result.Dimensions))
	}
}

func NewService(cfg config.Config) *Service {
	return &Service{
		deepseek:     NewDeepSeekClient(cfg.DeepSeek.BaseURL, cfg.DeepSeek.APIKey, cfg.DeepSeek.Model, cfg.DeepSeek.TimeoutSecs, cfg.DeepSeek.MaxTokens),
		maxCodeBytes: cfg.DeepSeek.MaxCodeBytes,
		sandbox:      sandbox.New(cfg.Sandbox.Enabled, cfg.Sandbox.RunnerURL, cfg.Sandbox.RunnerToken, time.Duration(cfg.Sandbox.JobTimeoutSeconds)*time.Second),
	}
}

func (s *Service) Evaluate(ctx context.Context, assignment domain.Assignment, code string, history []domain.Submission) (domain.Evaluation, error) {
	execution, err := s.sandbox.Run(ctx, assignment.Language, code, assignment.TestCases)
	if err != nil {
		return domain.Evaluation{}, err
	}
	if !assignment.LLMEvaluationEnabled {
		result := Evaluate(code, assignment.Rubric)
		result.Provider = "rules"
		applyExecutionEvidence(&result, assignment, execution)
		return result, nil
	}
	if s.deepseek.APIKeyMissing() {
		return domain.Evaluation{}, fmt.Errorf("DeepSeek API key is not configured")
	}
	if len([]byte(code)) > s.maxCodeBytes {
		return domain.Evaluation{}, fmt.Errorf("code exceeds the %d byte LLM evaluation limit", s.maxCodeBytes)
	}
	return s.deepseek.Evaluate(ctx, assignment, code, history, execution)
}

func (s *Service) GenerateTestCases(ctx context.Context, title, language, description, referenceSolution string) ([]domain.TestCase, error) {
	if s.deepseek.APIKeyMissing() {
		return nil, fmt.Errorf("DeepSeek API key is not configured")
	}
	if strings.TrimSpace(title) == "" || strings.TrimSpace(language) == "" || strings.TrimSpace(description) == "" {
		return nil, fmt.Errorf("title, language and description are required")
	}
	if len(description)+len(referenceSolution) > 200000 {
		return nil, fmt.Errorf("assignment material exceeds 200000 bytes")
	}
	return s.deepseek.GenerateTestCases(ctx, title, language, description, referenceSolution)
}
