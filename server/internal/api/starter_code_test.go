package api

import (
	"strings"
	"testing"
	"time"

	"codeeval/server/internal/domain"
)

func TestStarterCodeMissingPreservesExistingAndExplicitEmptyClears(t *testing.T) {
	if got := (assignmentInput{}).starterCodeOr("existing"); got != "existing" {
		t.Fatal("legacy edit removed framework")
	}
	empty := ""
	if got := (assignmentInput{StarterCode: &empty}).starterCodeOr("existing"); got != "" {
		t.Fatal("framework could not be cleared")
	}
	if got := (assignmentInput{ReferenceSolution: "complete answer"}).starterCodeOr("public framework"); got != "public framework" {
		t.Fatal("reference answer replaced the student framework")
	}
}

func TestStarterCodeLengthIsValidatedSeparatelyFromPrivateMaterial(t *testing.T) {
	h := &Handler{supportedLanguages: map[string]bool{"python": true}}
	code := strings.Repeat("a", 64001)
	in := assignmentInput{Title: "task", Language: "Python", DueAt: time.Now(), Status: "open", MaxSubmissions: 1, Rubric: []domain.RubricItem{{Key: "correctness", Name: "function", Weight: 100}}, StarterCode: &code}
	if h.validateAssignmentInput(in) == "" {
		t.Fatal("oversized public framework accepted")
	}
	code = "def solve(data):\n    raise NotImplementedError\n"
	if err := h.validateAssignmentInput(in); err != "" {
		t.Fatal(err)
	}
}
