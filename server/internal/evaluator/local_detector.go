package evaluator

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"strings"
	"time"

	"codeeval/server/internal/domain"
)

var ErrLocalDetectorInput = errors.New("代码超出本地分类器处理范围；本次未生成分数")

type LocalDetectorClient struct {
	url, token     string
	requiredDevice string
	requiredModel  string
	http           *http.Client
}

func NewLocalDetectorClient(url, token string, timeout time.Duration) *LocalDetectorClient {
	if timeout <= 0 {
		timeout = 180 * time.Second
	}
	return &LocalDetectorClient{url: strings.TrimRight(url, "/"), token: token, http: &http.Client{
		Timeout:       timeout,
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}}
}

func (c *LocalDetectorClient) Detect(ctx context.Context, language, code string) (domain.AIDetection, error) {
	language = normalizeDetectorLanguage(language)
	body, err := json.Marshal(map[string]string{"language": language, "code": code})
	if err != nil {
		return domain.AIDetection{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url+"/v1/detect", bytes.NewReader(body))
	if err != nil {
		return domain.AIDetection{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	res, err := c.http.Do(req)
	if err != nil {
		return domain.AIDetection{}, fmt.Errorf("local detector request: %w", err)
	}
	defer res.Body.Close()
	if res.StatusCode == http.StatusRequestEntityTooLarge || res.StatusCode == http.StatusUnprocessableEntity {
		return domain.AIDetection{}, ErrLocalDetectorInput
	}
	if res.StatusCode != http.StatusOK {
		return domain.AIDetection{}, fmt.Errorf("local detector returned HTTP %d", res.StatusCode)
	}
	const maxResponse = 256 * 1024
	data, err := io.ReadAll(io.LimitReader(res.Body, maxResponse+1))
	if err != nil {
		return domain.AIDetection{}, fmt.Errorf("read local detection: %w", err)
	}
	if len(data) > maxResponse {
		return domain.AIDetection{}, fmt.Errorf("local detector response exceeds limit")
	}
	var local domain.LocalDetection
	if err := json.Unmarshal(data, &local); err != nil {
		return domain.AIDetection{}, fmt.Errorf("decode local detection: %w", err)
	}
	if err := validateLocalDetection(local, language, code); err != nil {
		return domain.AIDetection{}, err
	}
	modelSize := local.ModelSize
	if modelSize == "" { // Legacy Base service/report compatibility.
		modelSize = "base"
	}
	if c.requiredModel != "" && modelSize != c.requiredModel {
		return domain.AIDetection{}, fmt.Errorf("configured %s model but detector reported %s", c.requiredModel, modelSize)
	}
	modelName := "DroidDetect-Base-Binary"
	if modelSize == "large" {
		modelName = "DroidDetect-Large-Binary"
	}
	if c.requiredDevice == "cuda" && !strings.HasPrefix(local.Device, "cuda:") {
		return domain.AIDetection{}, fmt.Errorf("CUDA detection was requested but the detector did not report CUDA execution")
	}
	if c.requiredDevice == "cpu" && local.Device != "cpu" {
		return domain.AIDetection{}, fmt.Errorf("CPU detection was requested but the detector did not report CPU execution")
	}
	result := domain.AIDetection{
		Status: "insufficient_evidence", Evidence: []domain.AIEvidence{}, LocalDetection: &local,
		Model: modelName + "/" + local.CheckpointRevision, ModelCalls: len(local.Chunks),
		ScoringVersion: local.Version, GeneratedAt: time.Now().UTC(),
		Summary: "没有可检测的非空白源码，未生成倾向分。",
		Checks: []string{
			"仅分析本次提交源码；未调用外部模型接口或执行提交代码。",
			fmt.Sprintf("完整分析 %d 个代码词元、%d 个片段，未截断源码。", local.TotalTokens, len(local.Chunks)),
		},
		AggregationNotes: []string{
			"每片段最多 512 个模型词元（含特殊词元），相邻片段重叠 64 个内容词元。",
			"综合分为各片段 AI 分类分数按新增覆盖词元数加权的均值；重叠内容不重复增加权重。",
			"使用二分类 softmax 的 MACHINE_GENERATED（类别 1）分数；不是已校准概率或 AI 编写行数占比。",
			"片段行范围表示模型分析的区域，不是逐行归属或可解释的来源证据；区间分类仅用于复核排序。",
		},
		Limitations: []string{
			"当前权重尚未通过本项目课程作业的独立标注样本验证；不能单独作为违规认定或扣分依据。",
			"长代码分块及加权汇总属于本项目适配；保留原始注释和空白，需要单独评估，不能沿用论文准确率。",
			"本分类器仅分析源码，不纳入题面、公共框架排除、提交历史或沙箱结果；模板代码可能影响分数。",
		},
	}
	if local.AIScore != nil {
		rate := *local.AIScore * 100
		result.AIRate, result.Status = &rate, "estimated"
		result.Summary = fmt.Sprintf("已完成 %d 个片段的代码分类检测，综合生成倾向分 %.1f%%；片段结果可供教师复核。", len(local.Chunks), rate)
	}
	return result, nil
}

func validateLocalDetection(r domain.LocalDetection, language, code string) error {
	invalid := func() error { return fmt.Errorf("local detector returned inconsistent or incomplete coverage") }
	expectedRepo := "project-droid/DroidDetect-Base-Binary"
	if r.ModelSize == "large" {
		expectedRepo = "project-droid/DroidDetect-Large-Binary"
	} else if r.ModelSize != "" && r.ModelSize != "base" {
		return invalid()
	}
	if r.ModelSize == "large" && r.ModelRepository == "" || r.ModelRepository != "" && r.ModelRepository != expectedRepo {
		return invalid()
	}
	if r.Version != "droiddetect-binary-chunks-v1" || r.Language != language || r.Truncated || r.TotalTokens < 0 || r.CoveredTokens != r.TotalTokens || len(r.Chunks) > 64 || r.MaxSequenceTokens != 512 || r.OverlapTokens != 64 || r.EncoderRevision == "" || r.CheckpointRevision == "" || r.PreprocessingVersion != "raw-source-v1" {
		return invalid()
	}
	if r.TotalTokens == 0 {
		if len(r.Chunks) != 0 || r.AIScore != nil {
			return invalid()
		}
		return nil
	}
	if r.AIScore == nil || !validClassifierScore(*r.AIScore) || len(r.Chunks) == 0 {
		return invalid()
	}
	weight, weighted, previousStart := 0, 0.0, 0
	lines := strings.Count(code, "\n") + 1
	for i, chunk := range r.Chunks {
		if chunk.Index != i+1 || chunk.StartLine < 1 || chunk.EndLine < chunk.StartLine || chunk.EndLine > lines || chunk.StartLine < previousStart || chunk.TokenCount < 1 || chunk.TokenCount > 510 || chunk.WeightTokens < 1 || chunk.WeightTokens > chunk.TokenCount || !validClassifierScore(chunk.AIScore) {
			return invalid()
		}
		if i == 0 && chunk.WeightTokens != chunk.TokenCount || i > 0 && chunk.WeightTokens != chunk.TokenCount-r.OverlapTokens {
			return invalid()
		}
		weight += chunk.WeightTokens
		weighted += chunk.AIScore * float64(chunk.WeightTokens)
		previousStart = chunk.StartLine
	}
	if weight != r.TotalTokens || math.Abs(weighted/float64(weight)-*r.AIScore) > 1e-6 {
		return invalid()
	}
	return nil
}

func validClassifierScore(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0) && value >= 0 && value <= 1
}
