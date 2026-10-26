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

const validAIResult = `{"status":"estimated","aiRate":72.5,"confidence":0.6,"summary":"结构有生成倾向，但人工编写同样可能","evidence":[{"startLine":2,"endLine":2,"quote":"print(value)","explanation":"统一的输出路径，也可能是人工实现"}],"limitations":["无法获取实际编写过程"]}`

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
		return jsonResponse(strings.Replace(validAIResult, "72.5", "35", 1)), nil
	})
	service := &Service{deepseek: client, maxCodeBytes: 1000}
	for i, want := range []float64{72.5, 35} {
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
			Language          string `json:"language"`
			Description       string `json:"description"`
		}
		if err := json.Unmarshal([]byte(input.Messages[1].Content), &material); err != nil {
			t.Fatal(err)
		}
		if len(material.StudentCode) != 2 || material.StudentCode[0].Line != 1 || material.StudentCode[0].Code != "value = 1" || material.StudentCode[1].Line != 2 || material.StudentCode[1].Code != "print(value)" || material.ReferenceSolution != "print(1)" || material.Language != "Python" || material.Description != "输出一个整数" {
			t.Fatalf("missing context: %v", material)
		}
		return jsonResponse(validAIResult), nil
	})
	service := &Service{deepseek: client, maxCodeBytes: 1000}
	result, err := service.DetectAICode(context.Background(), domain.Assignment{Title: "输出", Language: "Python", Description: "输出一个整数", ReferenceSolution: "print(1)"}, "value = 1\r\nprint(value)")
	if err != nil || result.AIRate == nil || *result.AIRate != 72.5 || result.Model != "existing-model" || result.ModelCalls != 1 || result.GeneratedAt.IsZero() {
		t.Fatalf("unexpected result: %+v %v", result, err)
	}
}

func TestAIDetectionRejectsUntrustedModelResults(t *testing.T) {
	for name, output := range map[string]string{
		"out of range rate":      strings.Replace(validAIResult, "72.5", "101", 1),
		"negative rate":          strings.Replace(validAIResult, "72.5", "-1", 1),
		"missing rate":           strings.Replace(validAIResult, `"aiRate":72.5,`, "", 1),
		"missing confidence":     strings.Replace(validAIResult, `"confidence":0.6,`, "", 1),
		"invalid confidence":     strings.Replace(validAIResult, `"confidence":0.6`, `"confidence":1.2`, 1),
		"fabricated quote":       strings.Replace(validAIResult, `"quote":"print(value)"`, `"quote":"print(fake)"`, 1),
		"insufficient with rate": strings.Replace(validAIResult, "estimated", "insufficient_evidence", 1),
		"invalid JSON":           `{"status":`,
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
		`{"status":"insufficient_evidence","aiRate":null,"confidence":0.2,"summary":"代码过短","limitations":["标准语句无法区分来源"]}`,
		strings.Replace(strings.Replace(validAIResult, "72.5", "0", 1), `"confidence":0.6`, `"confidence":0`, 1),
	} {
		client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
		client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) { return jsonResponse(output), nil })
		result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
		if err != nil || result.Evidence == nil || result.Status == "insufficient_evidence" && result.AIRate != nil {
			t.Fatalf("valid zero or insufficient result rejected: %+v %v", result, err)
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
		return jsonResponse(`{"status":"insufficient_evidence","aiRate":null,"confidence":0.1,"summary":"证据不足","limitations":["无法判断来源"]}`), nil
	})
	result, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	if err != nil || result.ModelCalls != 2 || result.AIRate != nil || len(result.Evidence) != 0 {
		t.Fatalf("invalid prior evidence retained: %+v %v", result, err)
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
	if err != nil || result.ModelCalls != 1 || result.Evidence[0].StartLine != 2 || result.Evidence[0].EndLine != 2 {
		t.Fatalf("repair failed: %+v %v", result, err)
	}
}

func TestAIDetectionReportsTypedEvidenceError(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "key", "model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(strings.Replace(validAIResult, "print(value)", "print(fake)", 1)), nil
	})
	_, err := client.DetectAICode(context.Background(), domain.Assignment{}, "value = 1\nprint(value)")
	var outputError *ModelOutputError
	if !errors.Is(err, ErrAIEvidence) || !errors.As(err, &outputError) {
		t.Fatalf("lost error classification: %v", err)
	}
}
