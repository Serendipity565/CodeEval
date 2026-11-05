package evaluator

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"codeeval/server/internal/domain"
)

const validAIResult = `{"summary":"结构有生成倾向，但人工编写同样可能","dimensions":[{"key":"task_fit","status":"assessed","score":3,"strength":"strong","reason":"任务实现存在合成测试特征","alternative":"也可能是人工实现","evidence":[{"startLine":1,"endLine":1,"quote":"value = 1","explanation":"合成任务依据"}]},{"key":"structure","status":"assessed","score":3,"strength":"strong","reason":"结构存在合成测试特征","alternative":"也可能是人工实现","evidence":[{"startLine":2,"endLine":2,"quote":"print(value)","explanation":"统一的输出路径，也可能是人工实现"}]},{"key":"comments","status":"insufficient_evidence","score":null,"strength":"none","reason":"没有注释","alternative":"","evidence":[]},{"key":"sample_match","status":"insufficient_evidence","score":null,"strength":"none","reason":"无样本匹配","evidence":[]},{"key":"history","status":"insufficient_evidence","score":null,"strength":"none","reason":"无历史材料","evidence":[]}],"limitations":["无法获取实际编写过程"]}`

const insufficientAIResult = `{"summary":"代码无法区分来源","dimensions":[{"key":"task_fit","status":"insufficient_evidence","score":null,"strength":"none","reason":"标准语句无法区分来源","evidence":[]},{"key":"structure","status":"insufficient_evidence","score":null,"strength":"none","reason":"标准语句无法区分来源","evidence":[]},{"key":"comments","status":"insufficient_evidence","score":null,"strength":"none","reason":"没有注释","evidence":[]},{"key":"sample_match","status":"insufficient_evidence","score":null,"strength":"none","reason":"无样本匹配","evidence":[]},{"key":"history","status":"insufficient_evidence","score":null,"strength":"none","reason":"无历史材料","evidence":[]}],"limitations":[]}`

func TestAIDetectionRepeatedRequestsCallModelIndependently(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid/v1", "key", "model", 2, 256)
	calls := 0
	var firstMessages []chatMessage
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		calls++
		var input chatRequest
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if len(input.Messages) != 2 || input.Temperature != 0 || input.Thinking["type"] != "disabled" || input.ResponseFormat["type"] != "json_object" {
			t.Fatalf("unexpected detection request: %+v", input)
		}
		if calls == 1 {
			firstMessages = input.Messages
			return jsonResponse(validAIResult), nil
		}
		if input.Messages[0] != firstMessages[0] || input.Messages[1] != firstMessages[1] {
			t.Fatal("identical input changed the detection prompt or included a prior result")
		}
		return jsonResponse(strings.Replace(validAIResult, `"score":3`, `"score":1`, 1)), nil
	})
	service := &Service{deepseek: client, maxCodeBytes: 1000}
	for i, want := range []float64{3, 2} {
		result, err := service.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
		if err != nil || result.AIRate == nil || *result.AIRate != want || calls != i+1 || result.ModelCalls != 1 {
			t.Fatalf("request reused an earlier result: %+v calls=%d err=%v", result, calls, err)
		}
	}
}

func TestAIDetectionReusesConfiguredClientAndAssignmentContext(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid/v1", "existing-key", "existing-model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(req *http.Request) (*http.Response, error) {
		if req.URL.String() != "https://example.invalid/v1/chat/completions" || req.Header.Get("Authorization") != "Bearer existing-key" {
			t.Fatal("did not reuse existing endpoint and credentials")
		}
		var input chatRequest
		if err := json.NewDecoder(req.Body).Decode(&input); err != nil {
			t.Fatal(err)
		}
		if input.Model != "existing-model" || input.ResponseFormat["type"] != "json_object" || input.Temperature != 0 || input.Thinking["type"] != "disabled" {
			t.Fatalf("wrong model or format: %+v", input)
		}
		var material struct {
			StudentCode []struct {
				Line int    `json:"line"`
				Code string `json:"code"`
			} `json:"studentCode"`
			ReferenceSolution string `json:"referenceSolution"`
			StarterCode       string `json:"starterCode"`
			Language          string `json:"language"`
			Description       string `json:"description"`
		}
		if err := json.Unmarshal([]byte(input.Messages[1].Content), &material); err != nil {
			t.Fatal(err)
		}
		if len(material.StudentCode) != 2 || material.StudentCode[0].Line != 1 || material.StudentCode[0].Code != "value = 1" || material.StudentCode[1].Line != 2 || material.StudentCode[1].Code != "print(value)" || material.ReferenceSolution != "" || material.StarterCode != "pass # TODO" || material.Language != "Python" || material.Description != "输出一个整数" {
			t.Fatalf("missing context: %v", material)
		}
		return jsonResponse(validAIResult), nil
	})
	service := &Service{deepseek: client, maxCodeBytes: 1000}
	result, err := service.DetectAICode(context.Background(), domain.Assignment{Title: "输出", Language: "Python", Description: "输出一个整数", StarterCode: "pass # TODO", ReferenceSolution: "private-answer-marker"}, "value = 1\r\nprint(value)")
	if err != nil || result.AIRate == nil || *result.AIRate != 3 || result.Model != "existing-model" || result.PromptVersion != aiDetectionPromptVersion || result.ModelCalls != 1 || result.GeneratedAt.IsZero() {
		t.Fatalf("unexpected result: %+v %v", result, err)
	}
}

func TestAIDetectionRejectsUntrustedModelResults(t *testing.T) {
	for name, output := range map[string]string{
		"out of range score":      strings.Replace(validAIResult, `"score":3`, `"score":101`, 1),
		"negative score":          strings.Replace(validAIResult, `"score":3`, `"score":-1`, 1),
		"missing score":           strings.Replace(validAIResult, `"score":3,`, "", 1),
		"fractional score":        strings.Replace(validAIResult, `"score":3`, `"score":1.5`, 1),
		"unknown dimension":       strings.Replace(validAIResult, `"task_fit"`, `"made_up"`, 1),
		"duplicate dimension":     strings.Replace(validAIResult, `"structure"`, `"task_fit"`, 1),
		"missing dimensions":      `{"summary":"test","limitations":[]}`,
		"unknown strength":        strings.Replace(validAIResult, `"strength":"strong"`, `"strength":"certain"`, 1),
		"insufficient with score": strings.Replace(validAIResult, `"status":"assessed"`, `"status":"insufficient_evidence"`, 1),
		"invalid JSON":            `{"dimensions":`,
		"missing limitations":     strings.Replace(validAIResult, `,"limitations":["无法获取实际编写过程"]`, "", 1),
		"too many limitations":    strings.Replace(validAIResult, `["无法获取实际编写过程"]`, `["限制一","限制二","限制三"]`, 1),
		"blank limitation":        strings.Replace(validAIResult, `["无法获取实际编写过程"]`, `[" "]`, 1),
	} {
		t.Run(name, func(t *testing.T) {
			client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
			calls := 0
			client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
				calls++
				return jsonResponse(output), nil
			})
			if _, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)"); err == nil || calls != 2 {
				t.Fatalf("invalid model result accepted or retry policy changed: %v calls=%d", err, calls)
			}
		})
	}
}

func TestAIDetectionInsufficientEvidenceAndExplicitZero(t *testing.T) {
	for _, output := range []string{
		insufficientAIResult,
		strings.ReplaceAll(validAIResult, `"score":3`, `"score":0`),
	} {
		client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
		client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { return jsonResponse(output), nil })
		result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
		if err != nil || result.Evidence == nil || result.Status == "insufficient_evidence" && result.AIRate != nil {
			t.Fatalf("valid zero or insufficient result rejected: %+v %v", result, err)
		}
	}
}

func TestAIDetectionAllowsDirectJudgmentWithoutBoilerplateOrForcingARate(t *testing.T) {
	for _, output := range []string{
		strings.Replace(validAIResult, `["无法获取实际编写过程"]`, `[]`, 1),
		strings.ReplaceAll(strings.Replace(validAIResult, `["无法获取实际编写过程"]`, `[]`, 1), `"alternative":"也可能是人工实现",`, ""),
		insufficientAIResult,
	} {
		client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
		client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { return jsonResponse(output), nil })
		result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
		if err != nil || result.Limitations == nil || len(result.Limitations) != 0 {
			t.Fatalf("report requires boilerplate limitations: %+v %v", result, err)
		}
		if result.ModelCalls != 1 {
			t.Fatalf("direct judgment triggered an unnecessary retry: %+v", result)
		}
		if result.Status == "insufficient_evidence" && result.AIRate != nil {
			t.Fatal("direct wording manufactured a rate for insufficient evidence")
		}
	}
}

func TestAIDetectionRetriesInvalidEvidenceAndResetsOutput(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	calls := 0
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		if calls == 1 {
			return jsonResponse(strings.Replace(validAIResult, "print(value)", "invented()", 1)), nil
		}
		return jsonResponse(validAIResult), nil
	})
	result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	if err != nil || result.ModelCalls != 2 || result.AIRate == nil || *result.AIRate != 3 || len(result.Evidence) != 2 {
		t.Fatalf("corrected analysis not retained: %+v %v", result, err)
	}
}

func TestAIDetectionAllFiveDimensionsReturnDirectJudgments(t *testing.T) {
	assignment := domain.Assignment{Language: "Python"}
	code := "value = 1\nprint(value)\n# explanation"
	material := domain.AIDetectionContext{
		History: []domain.Submission{{ID: "previous", Code: "value = 0\nprint(value)"}},
		SampleBank: &domain.AISampleBank{Samples: []domain.AISample{
			{ID: "sample-1", Code: "print(1)"},
			{ID: "sample-2", Code: "print(2)"},
			{ID: "sample-3", Code: "print(3)"},
		}},
	}
	for _, extraAlternative := range []string{"", "旧格式反向解释"} {
		dimensions := []domain.AIDimension{}
		for _, rule := range aiDimensionRules {
			score := 72
			d := domain.AIDimension{Key: rule.key, Status: "assessed", Score: &score, Strength: "moderate", Reason: "直接判断与具体代码特征", Alternative: extraAlternative, Evidence: []domain.AIEvidence{{CitationID: "code-001", Explanation: "对应代码特征"}}}
			if rule.key == "sample_match" {
				d.Evidence = []domain.AIEvidence{}
			}
			if rule.key == "history" {
				d.Evidence[0].SourceID = "previous"
				d.Evidence[0].SourceCitationID = "code-001"
			}
			dimensions = append(dimensions, d)
		}
		output := mustJSON(map[string]any{"summary": "直接判断", "dimensions": dimensions, "limitations": []string{}})
		client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
		client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { return jsonResponse(output), nil })
		result, err := client.DetectAICode(context.Background(), assignment, code, material)
		if err != nil || result.ModelCalls != 1 || result.Coverage != 1 || result.AIRate == nil || *result.AIRate != 72 || len(result.Dimensions) != 5 {
			t.Fatalf("five direct judgments did not complete in one call: %+v %v", result, err)
		}
		for _, d := range result.Dimensions {
			if !d.Included || d.Alternative != "" || d.Reason != "直接判断与具体代码特征" {
				t.Fatalf("dimension did not retain a direct judgment: %+v", d)
			}
		}
		if strings.Contains(mustJSON(result), `"alternative"`) {
			t.Fatal("new report retained counterexplanation fields")
		}
	}
}

func TestAIDetectionInputAndConfigurationErrorsDoNotCallModel(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "", "model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Fatal("invalid request reached model")
		return nil, nil
	})
	service := &Service{deepseek: client, maxCodeBytes: 16}
	for _, code := range []string{"", " \n ", strings.Repeat("a", 17)} {
		if _, err := service.DetectAICode(context.Background(), domain.Assignment{}, code); !errors.Is(err, ErrAIInput) {
			t.Fatalf("invalid code accepted: %v", err)
		}
	}
	if _, err := service.DetectAICode(context.Background(), domain.Assignment{}, "print(1)"); !errors.Is(err, ErrAIUnavailable) {
		t.Fatalf("missing key not reported: %v", err)
	}
}

func TestAIEvidenceCorrectsLineNumbersAndIndentationFromActualSource(t *testing.T) {
	for _, test := range []struct {
		name, code, quote              string
		start, end, wantStart, wantEnd int
	}{
		{"wrong line", "value = 1\nprint(value)", "print(value)", 1, 1, 2, 2},
		{"out of bounds", "value = 1\nprint(value)", "print(value)", 99, 99, 2, 2},
		{"blank lines", "\nvalue = 1\n\nprint(value)\n", "print(value)", 2, 2, 4, 4},
		{"indentation", "def solve():\n    value = 1\n    print(value)", "value = 1\nprint(value)", 1, 2, 2, 3},
		{"declared indentation", "    print(value)\n    print(value)", "\tprint(value)", 2, 2, 2, 2},
		{"CRLF quote", "value = 1\nprint(value)", "value = 1\r\nprint(value)", 1, 2, 1, 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			lines := strings.Split(test.code, "\n")
			evidence := domain.AIEvidence{StartLine: test.start, EndLine: test.end, Quote: test.quote, Explanation: "合成代码依据"}
			if err := normalizeAIEvidence(&evidence, lines); err != nil {
				t.Fatal(err)
			}
			if evidence.StartLine != test.wantStart || evidence.EndLine != test.wantEnd || !strings.Contains(strings.Join(lines[evidence.StartLine-1:evidence.EndLine], "\n"), evidence.Quote) {
				t.Fatalf("invalid repaired evidence: %+v", evidence)
			}
		})
	}
}

func TestAIEvidenceRejectsAmbiguousOrChangedCode(t *testing.T) {
	for _, test := range []struct {
		code, quote string
		start, end  int
	}{
		{"print(value)\nprint(value)", "print(value)", 99, 99},
		{"    print(value)\n    print(value)", "\tprint(value)", 99, 99},
		{"print(\"a  b\")", "print(\"a b\")", 1, 1},
		{"print(value)", "print(fake)", 1, 1},
		{"value = 1\nprint(value)", "value = 1\n...\nprint(value)", 1, 2},
	} {
		evidence := domain.AIEvidence{StartLine: test.start, EndLine: test.end, Quote: test.quote, Explanation: "合成依据"}
		if err := normalizeAIEvidence(&evidence, strings.Split(test.code, "\n")); err == nil {
			t.Fatalf("unverified quote accepted: %+v", evidence)
		}
	}
}

func TestAIDetectionRepairsMiscountedLinesWithoutAnotherModelCall(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(strings.ReplaceAll(validAIResult, `Line":2`, `Line":99`)), nil
	})
	result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	if err != nil || result.ModelCalls != 1 || result.Evidence[1].StartLine != 2 || result.Evidence[1].EndLine != 2 {
		t.Fatalf("repair failed: %+v %v", result, err)
	}
}

func TestAIDetectionNeverSavesUnknownDimensionsAsCitationRecovery(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	calls := 0
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		calls++
		return jsonResponse(strings.Replace(validAIResult, "print(value)", "print(fake)", 1)), nil
	})
	result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	if err == nil || result.ScoringVersion != "" || calls != 4 {
		t.Fatalf("citation failure silently returned a partial success: %+v %v calls=%d", result, err, calls)
	}
	dimensions := aiDimensionFixture(t)
	dimensions[1].Evidence[0].Quote = "invented()"
	if err := validateAIDimensions(dimensions, []string{"value = 1", "print(value)"}); !errors.Is(err, ErrAIEvidence) {
		t.Fatalf("strict validator accepted fabricated citations: %v", err)
	}
}
