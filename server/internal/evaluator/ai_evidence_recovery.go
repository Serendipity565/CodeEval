package evaluator

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"codeeval/server/internal/domain"
)

// Re-analyze only failed dimensions against real, server-numbered source blocks.
// Do not salvage a score with invalid quotations or silently discard a dimension.
func (c *DeepSeekClient) repairAICitations(ctx context.Context, assignment domain.Assignment, code string, verification aiVerification, previous []domain.AIDimension, failures map[string]error) ([]domain.AIDimension, []string, int, error) {
	if err := validateAIDimensionShapes(previous); err != nil {
		return nil, nil, 0, err
	}
	keys, diagnostics := []string{}, []string{}
	for _, rule := range aiDimensionRules {
		if err, failed := failures[rule.key]; failed {
			keys = append(keys, rule.key)
			diagnostics = append(diagnostics, rule.key+": "+err.Error())
		}
	}
	if len(keys) == 0 {
		return nil, nil, 0, fmt.Errorf("%w: no failed dimension available for citation repair", ErrAIEvidence)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(aiDetectionInput(assignment, code, verification)), &input); err != nil {
		return nil, nil, 0, err
	}
	input["dimensionsToReview"], input["citationErrors"] = keys, diagnostics
	var out struct {
		Dimensions []domain.AIDimension `json:"dimensions"`
	}
	var repaired []domain.AIDimension
	lines := strings.Split(code, "\n")
	system := aiDetectionSystem + `
本次为独立引用定位复核。只返回 dimensionsToReview 指定的维度，JSON为 {"dimensions":[...]}，不返回其他维度。重新阅读真实源码独立分析，不使用不存在的引用作为事实。task_fit、structure 有完整当前代码，必须重新给出 assessed、整数score、strength、reason、alternative 及1至4条真实依据，不因之前定位失败而标成无法判断。当前代码依据只返回 {"citationId":"从currentEvidence.id原样选择","explanation":"该代码与本维度的具体关系"}，不抄写quote或填写startLine/endLine。history 使用 citationId、sourceId、sourceCitationId 选择两侧真实片段，不自行抄写行号；sample_match遵守完整样本评分规则。真正没有注释或历史材料时相应维度可未知。`
	calls, err := c.completeValidated(ctx, system, mustJSON(input), &out, func() error {
		if len(out.Dimensions) != len(keys) {
			return fmt.Errorf("repair must return exactly the requested dimensions")
		}
		merged := append([]domain.AIDimension{}, previous...)
		seen := map[string]bool{}
		for _, d := range out.Dimensions {
			if _, requested := failures[d.Key]; !requested || seen[d.Key] {
				return fmt.Errorf("unexpected or duplicate repaired dimension %s", d.Key)
			}
			seen[d.Key] = true
			if (d.Key == "task_fit" || d.Key == "structure") && d.Status != "assessed" {
				return fmt.Errorf("%w: repair current-code dimension %s rather than dropping its assessment", ErrAIEvidence, d.Key)
			}
			for _, e := range d.Evidence {
				if (d.Key == "task_fit" || d.Key == "structure" || d.Key == "comments") && e.CitationID == "" {
					return fmt.Errorf("%w: repaired current-code evidence must select currentEvidence.id", ErrAIEvidence)
				}
			}
			for i := range merged {
				if merged[i].Key == d.Key {
					merged[i] = d
				}
			}
		}
		if err := requireAISampleAssessment(merged, verification.SampleComparison); err != nil {
			return err
		}
		if err := validateAIDimensions(merged, lines, verification); err != nil {
			return err
		}
		repaired = merged
		return nil
	})
	if err != nil {
		return nil, nil, calls, fmt.Errorf("citation repair (%s): %w", strings.Join(keys, ", "), err)
	}
	notes := []string{"引用定位：" + strings.Join(keys, "、") + " 已使用服务器编号的真实代码片段重新分析并通过校验；未因定位错误清空维度或以默认分数填充。"}
	return repaired, notes, calls, nil
}
