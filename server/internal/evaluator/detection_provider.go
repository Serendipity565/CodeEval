package evaluator

import (
	"context"
	"strings"

	"codeeval/server/internal/domain"
)

type DetectionOptions struct {
	Provider        string `json:"provider"`
	Available       bool   `json:"available"`
	RequiresSamples bool   `json:"requiresSamples"`
	Description     string `json:"description"`
	RequiresContext bool   `json:"-"`
}

// AIDetectionProvider is the boundary between report workflows and detection
// implementations. Providers own their context requirements and result format;
// API handlers and the UI do not need backend-specific branching.
type AIDetectionProvider interface {
	Supports(language string) bool
	Options(domain.Assignment) DetectionOptions
	Detect(context.Context, domain.Assignment, string, domain.AIDetectionContext) (domain.AIDetection, error)
}

type detectionRouter struct {
	mode     string
	local    AIDetectionProvider
	deepseek AIDetectionProvider
}

func newDetectionRouter(mode string, local *LocalDetectorClient, service *Service) *detectionRouter {
	mode = strings.ToLower(strings.TrimSpace(mode))
	if mode == "llmsniffer" {
		mode = "droiddetect"
	}
	if mode == "ds" {
		mode = "deepseek"
	}
	return &detectionRouter{mode: mode, local: &localDetectionProvider{client: local}, deepseek: &deepSeekDetectionProvider{service: service}}
}

func (r *detectionRouter) provider(language string) AIDetectionProvider {
	if r.mode == "droiddetect" || r.mode == "auto" && r.local.Supports(language) {
		return r.local
	}
	return r.deepseek
}

func (s *Service) detectionBackend(language string) AIDetectionProvider {
	if s.detection != nil {
		return s.detection.provider(language)
	}
	// Retain compatibility with in-package callers constructing Service directly.
	return &deepSeekDetectionProvider{service: s}
}

func (s *Service) DetectionOptions(a domain.Assignment) DetectionOptions {
	return s.detectionBackend(a.Language).Options(a)
}

type localDetectionProvider struct{ client *LocalDetectorClient }

func (p *localDetectionProvider) Supports(language string) bool {
	language = normalizeDetectorLanguage(language)
	return language == "python" || language == "java" || language == "cpp" || language == "go"
}

func (p *localDetectionProvider) Options(a domain.Assignment) DetectionOptions {
	supported := p.Supports(a.Language)
	description := "使用代码分类检测，完整分块分析；分数表示生成倾向，不代表 AI 编写行数占比。"
	if !supported {
		description = "当前本地分类器支持 Python、Java、C++、Go，无法检测此作业语言。"
	}
	return DetectionOptions{Provider: "droiddetect", Available: supported && p.client != nil && p.client.url != "", Description: description}
}

func (p *localDetectionProvider) Detect(ctx context.Context, a domain.Assignment, code string, _ domain.AIDetectionContext) (domain.AIDetection, error) {
	if !p.Options(a).Available {
		return domain.AIDetection{}, ErrAIUnavailable
	}
	return p.client.Detect(ctx, a.Language, code)
}

type deepSeekDetectionProvider struct{ service *Service }

func (p *deepSeekDetectionProvider) Supports(string) bool { return true }

func (p *deepSeekDetectionProvider) Options(domain.Assignment) DetectionOptions {
	return DetectionOptions{
		Provider: "deepseek", Available: p.service.deepseek != nil && !p.service.deepseek.APIKeyMissing(),
		RequiresSamples: true, RequiresContext: true,
		Description: "使用题面、同题样本与提交历史进行上下文分析，分数表示生成倾向。",
	}
}

func (p *deepSeekDetectionProvider) Detect(ctx context.Context, a domain.Assignment, code string, material domain.AIDetectionContext) (domain.AIDetection, error) {
	if !p.Options(a).Available {
		return domain.AIDetection{}, ErrAIUnavailable
	}
	verification, err := p.service.prepareAIVerification(ctx, a, code, material)
	if err != nil {
		return domain.AIDetection{}, err
	}
	return p.service.deepseek.detectAICode(ctx, a, code, verification)
}

var _ AIDetectionProvider = (*localDetectionProvider)(nil)
var _ AIDetectionProvider = (*deepSeekDetectionProvider)(nil)

func normalizeDetectorLanguage(language string) string {
	language = strings.ToLower(strings.TrimSpace(language))
	if language == "c++" || language == "cxx" {
		return "cpp"
	}
	return language
}
