package evaluator

import (
	"context"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"codeeval/server/internal/domain"
)

type aiSourceLine struct {
	Line int    `json:"line"`
	Code string `json:"code"`
}

func aiSource(code string) []aiSourceLine {
	lines := strings.Split(strings.ReplaceAll(code, "\r\n", "\n"), "\n")
	out := make([]aiSourceLine, len(lines))
	for i, line := range lines {
		out[i] = aiSourceLine{Line: i + 1, Code: line}
	}
	return out
}

type aiPriorVersion struct {
	SubmissionID string              `json:"submissionId"`
	SubmittedAt  time.Time           `json:"submittedAt"`
	Source       []aiSourceLine      `json:"source,omitempty"`
	Evidence     []aiCurrentEvidence `json:"evidence,omitempty"`
	Omitted      bool                `json:"sourceOmitted"`
}

type aiSampleSource struct {
	ID       string         `json:"id"`
	Approach string         `json:"approach"`
	Source   []aiSourceLine `json:"source"`
}

func aiSampleSources(bank *domain.AISampleBank) []aiSampleSource {
	out := []aiSampleSource{}
	if bank != nil {
		for _, sample := range bank.Samples {
			out = append(out, aiSampleSource{ID: sample.ID, Approach: sample.Approach, Source: aiSource(sample.Code)})
		}
	}
	return out
}

type aiVerification struct {
	Checks           []string                   `json:"checks"`
	ExecutionSource  string                     `json:"executionSource"`
	Execution        *domain.ExecutionEvidence  `json:"execution,omitempty"`
	History          []aiPriorVersion           `json:"priorVersions"`
	ReferenceStatus  string                     `json:"referenceStatus"`
	Reference        *domain.SimilarityPair     `json:"referenceComparison,omitempty"`
	SampleComparison *domain.AISampleComparison `json:"sampleComparison"`
	SampleModelCalls int                        `json:"-"`
	SampleEvidence   []aiMatchedEvidence        `json:"sampleEvidence"`
	SampleSources    []aiSampleSource           `json:"sampleSources"`
}

// This is an evidence snapshot assembled by the server, never by the model.
func buildAIVerification(ctx context.Context, assignment domain.Assignment, code string, material domain.AIDetectionContext) aiVerification {
	out := aiVerification{History: []aiPriorVersion{}, ExecutionSource: "unavailable"}
	if strings.TrimSpace(assignment.StarterCode) != "" {
		out.Checks = append(out.Checks, "公共框架：题目提供的参考代码仅为起始框架，其相同接口、TODO 和输入输出代码不作为 AI 生成或抄袭依据；框架不是标准答案。")
	}
	if material.Execution != nil {
		out.ExecutionSource = "saved_evaluation"
		out.Execution = compactAIExecution(material.Execution)
		out.Checks = append(out.Checks, "运行核验：复用本份提交已保存的沙箱结果；未重新运行。")
	}
	for i, previous := range material.History {
		if i >= 3 {
			break
		}
		version := aiPriorVersion{SubmissionID: previous.ID, SubmittedAt: previous.SubmittedAt, Omitted: len(previous.Code) > 20000}
		if !version.Omitted {
			version.Source = aiSource(previous.Code)
			version.Evidence = aiCurrentEvidenceCatalog(strings.Split(strings.ReplaceAll(previous.Code, "\r\n", "\n"), "\n"))
		}
		out.History = append(out.History, version)
	}
	if len(out.History) == 0 {
		out.Checks = append(out.Checks, "提交历史：没有本份提交之前的同学生、同作业版本；平台提交记录不等于编辑过程或 AI 对话记录。")
	} else {
		omitted := 0
		for _, version := range out.History {
			if version.Omitted {
				omitted++
			}
		}
		out.Checks = append(out.Checks, fmt.Sprintf("提交历史：提供本份提交之前最近 %d 份同学生、同作业版本（最多 3 份）；其中 %d 份因超过 20000 字节仅提供编号与时间。版本变化不能直接证明 AI 来源，也不等于完整编辑或生成历史。", len(out.History), omitted))
	}
	out.ReferenceStatus = "not_used"
	out.Checks = append(out.Checks, "参考代码：选填且仅作教师存档，不参与本次 AI 识别或比对。")
	out.SampleComparison = compareAISamples(ctx, assignment, code, material.SampleBank)
	out.SampleEvidence = aiMatchedEvidenceCatalog(code, out.SampleComparison)
	out.SampleSources = aiSampleSources(material.SampleBank)
	return out
}

func (s *Service) prepareAIVerification(ctx context.Context, assignment domain.Assignment, code string, material domain.AIDetectionContext) (aiVerification, error) {
	out := buildAIVerification(ctx, assignment, code, material)
	if out.Execution == nil {
		switch {
		case len(assignment.TestCases) == 0:
			out.Checks = append(out.Checks, "运行核验：无已保存运行结果，且作业未配置测试用例，本次未运行。")
		case s.sandbox == nil || !s.sandbox.Enabled():
			out.Checks = append(out.Checks, "运行核验：无已保存运行结果，且沙箱未启用，本次未运行。")
		default:
			execution, err := s.sandbox.Run(ctx, assignment.Language, code, assignment.TestCases)
			if err != nil {
				if ctx.Err() != nil {
					return out, ctx.Err()
				}
				out.Checks = append(out.Checks, "运行核验：尝试沙箱执行失败，未取得运行结果；服务故障不能作为代码错误或 AI 来源依据。")
			} else if execution != nil {
				out.ExecutionSource = "sandbox_run"
				out.Execution = compactAIExecution(execution)
				out.Checks = append(out.Checks, "运行核验：本次使用作业已配置的测试用例执行沙箱验证；未改变成绩。")
			} else {
				out.Checks = append(out.Checks, "运行核验：沙箱未返回运行证据，本次没有可用运行结果。")
			}
		}
	}
	if out.Execution != nil {
		e := out.Execution
		if e.CompileOK {
			out.Checks = append(out.Checks, fmt.Sprintf("测试结果：编译通过，测试通过 %d/%d；向模型提供前 %d 项用例结果。测试仅覆盖已配置用例，未单独验证的边界只能表述为静态推测；通过或失败本身不能证明代码来源。", e.Passed, e.Total, len(e.Results)))
		} else {
			out.Checks = append(out.Checks, "测试结果：沙箱编译失败，不能据此推断 AI 来源。编译信息："+clipAIText(e.CompileError, 1000))
		}
	}
	if material.SampleBank == nil && s.aiSampleStore != nil && assignment.ID != "" {
		bank, calls, err := s.loadOrGenerateAISamples(ctx, assignment)
		out.SampleModelCalls = calls
		if ctx.Err() != nil {
			return out, ctx.Err()
		}
		if err != nil {
			return out, err
		}
		if bank == nil || len(bank.Samples) != AISampleExpectedCount {
			return out, &AISampleError{Stage: "样本准备", Err: fmt.Errorf("complete sample bank required before detection")}
		}
		out.SampleComparison = compareAISamples(ctx, assignment, code, bank)
		out.SampleSources = aiSampleSources(bank)
		if !completeAISampleComparison(out.SampleComparison) {
			return out, &AISampleError{Stage: "样本比对", Err: fmt.Errorf("complete valid comparison required before detection")}
		}
	}
	out.Checks = append(out.Checks, out.SampleComparison.Note)
	out.SampleEvidence = aiMatchedEvidenceCatalog(code, out.SampleComparison)
	return out, ctx.Err()
}

func compactAIExecution(original *domain.ExecutionEvidence) *domain.ExecutionEvidence {
	e := *original
	e.CompileError = clipAIText(e.CompileError, 4000)
	n := len(e.Results)
	if n > 20 {
		n = 20
	}
	e.Results = append([]domain.TestResult{}, e.Results[:n]...)
	for i := range e.Results {
		r := &e.Results[i]
		r.Name = clipAIText(r.Name, 200)
		if r.Hidden {
			r.Input, r.Expected, r.Actual = "", "", ""
			switch r.Error {
			case "", "output mismatch", "time limit exceeded":
			default:
				r.Error = "runtime error"
			}
		} else {
			r.Input, r.Expected, r.Actual = clipAIText(r.Input, 2000), clipAIText(r.Expected, 2000), clipAIText(r.Actual, 2000)
		}
		r.Error = clipAIText(r.Error, 1000)
	}
	return &e
}

func clipAIText(text string, limit int) string {
	if len(text) <= limit {
		return text
	}
	for !utf8.RuneStart(text[limit]) {
		limit--
	}
	return text[:limit] + "（内容已截断）"
}
