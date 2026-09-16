package evaluator

import (
	"context"
	"net/http"
	"testing"
)

func TestGenerateTestCasesNormalizesModelOutput(t *testing.T) {
	client := NewDeepSeekClient("https://example.invalid", "test-key", "test-model", 2, 256)
	client.httpClient.Transport = roundTripFunc(func(*http.Request) (*http.Response, error) {
		return jsonResponse(`{"tests":[{"name":"基础","input":"1 2","expected":"3","hidden":true,"weight":0,"timeoutMs":0}]}`), nil
	})
	tests, err := client.GenerateTestCases(context.Background(), "求和", "Go", "读入两个整数并输出和", "")
	if err != nil {
		t.Fatal(err)
	}
	if len(tests) != 1 || tests[0].Hidden || tests[0].Weight != 1 || tests[0].TimeoutMS != 2000 {
		t.Fatalf("unexpected generated tests: %+v", tests)
	}
}
