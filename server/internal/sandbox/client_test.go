package sandbox

import (
	"testing"

	"codeeval/server/internal/domain"
)

func TestRunRedactsHiddenTestData(t *testing.T) {
	tests := []domain.TestCase{{Name: "public", Input: "1", Expected: "2"}, {Name: "hidden", Input: "secret-in", Expected: "secret-out", Hidden: true}}
	result := domain.ExecutionEvidence{Results: []domain.TestResult{{Name: "public", Actual: "wrong", Error: "output mismatch"}, {Name: "hidden", Actual: "secret", Error: "secret echoed to stderr"}}}
	if err := redactTestResults(&result, tests); err != nil {
		t.Fatal(err)
	}
	if result.Results[0].Input != "1" || result.Results[0].Expected != "2" || result.Results[0].Actual != "wrong" {
		t.Fatalf("public evidence missing: %+v", result.Results[0])
	}
	hidden := result.Results[1]
	if !hidden.Hidden || hidden.Input != "" || hidden.Expected != "" || hidden.Actual != "" || hidden.Error != "runtime error" {
		t.Fatalf("hidden evidence leaked: %+v", hidden)
	}
}
