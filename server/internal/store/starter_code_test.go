package store

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAssignmentKeepsAnswerFrameworkAndKnowledgeSeparate(t *testing.T) {
	assignment := assignmentFrom(AssignmentRecord{StarterCode: "public framework TODO", ReferenceSolution: "private full answer", KnowledgeBase: "private course knowledge"})
	if assignment.StarterCode != "public framework TODO" || assignment.ReferenceSolution != "private full answer" || assignment.KnowledgeBase != "private course knowledge" {
		t.Fatalf("assignment materials were conflated: %+v", assignment)
	}
	data, err := json.Marshal(assignment)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), "public framework TODO") || strings.Contains(string(data), "private full answer") || strings.Contains(string(data), "private course knowledge") {
		t.Fatalf("wrong student visibility: %s", data)
	}
}
