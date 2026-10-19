package domain

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"
)

const similarityExample = `def accumulate(values):
    total = 0
    for item in values:
        if item > 0:
            total = total + item * 2
    return total
print(accumulate([1, 2, 3]))`

func similarityPairReport(t *testing.T, language, a, b, template string) SimilarityReport {
	t.Helper()
	report, err := BuildSimilarity(context.Background(), "2", language, "selected_pair", template, []Submission{{ID: "1", StudentID: "10", Code: a}, {ID: "2", StudentID: "11", Code: b}})
	if err != nil {
		t.Fatal(err)
	}
	return report
}
func TestSimilarityMatchesRenamedCodeAndOriginalLineNumbers(t *testing.T) {
	renamed := strings.NewReplacer("accumulate", "solve", "values", "numbers", "total", "answer", "item", "number").Replace(similarityExample)
	report := similarityPairReport(t, "Python", similarityExample, "# extra comment\n\n"+renamed, "")
	pair := report.Pairs[0]
	if pair.Similarity != 100 || len(pair.Matches) != 1 || pair.Matches[0].Kind != "renamed" || pair.Matches[0].B.StartLine != 3 || pair.Matches[0].B.EndLine != 9 {
		t.Fatalf("missing renamed match or original positions: %+v", pair)
	}
}
func TestSimilarityIgnoresFormattingAndCommentsInSupportedLanguages(t *testing.T) {
	cases := []struct{ language, a, b string }{
		{"Python", similarityExample, strings.ReplaceAll(similarityExample, "total =", "total  =") + "\n# explanation"},
		{"Go", "package main\nimport \"fmt\"\nfunc main(){ x:=0; for i:=0;i<10;i++ {x+=i*2};fmt.Println(x) }", "package main\nimport (\n\"fmt\"\n)\n// notes\nfunc main() { x := 0; for i := 0; i < 10; i++ { x += i * 2 }; fmt.Println(x) }"},
		{"Java", "import java.util.*;\nclass Main { public static void main(String[] args) { int total=0;for(int i=0;i<10;i++){total+=i*2;}System.out.println(total);}}", "import java.io.*;\nclass Main {/* comment */public static void main(String[] args){int total = 0; for(int i = 0; i < 10; i++){total += i * 2;}System.out.println(total);}}"},
		{"C++", "#include <iostream>\nint main(){int total=0;for(int i=0;i<10;i++){total+=i*2;}std::cout<<total;return 0;}", "#include <bits/stdc++.h>\nint main() { int total = 0; // notes\nfor(int i = 0; i < 10; i++) {total += i * 2;} std::cout << total; return 0; }"},
	}
	for _, c := range cases {
		t.Run(c.language, func(t *testing.T) {
			p := similarityPairReport(t, c.language, c.a, c.b, "").Pairs[0]
			if p.Similarity != 100 || p.Matches[0].Kind != "exact" {
				t.Fatalf("format/comments affected evidence: %+v", p)
			}
		})
	}
}
func TestSimilarityExcludesRepeatedTemplateWithoutInventingMatches(t *testing.T) {
	template := "int compute(int value) { return value * 2 + 1; }"
	report := similarityPairReport(t, "C++", template+"\n"+template, template, template)
	if report.Pairs[0].MatchedTokens != 0 || report.Sources[0].TokenCount != 0 || report.Sources[1].TokenCount != 0 || report.Sources[0].ExcludedTokens == 0 {
		t.Fatalf("template was counted: %+v", report)
	}
	// Excluding a template must not glue together two short independent fragments.
	a := "x = 1 + 2 + 3;"
	b := "y = 5 + 6 + 7;"
	report = similarityPairReport(t, "C++", a+template+b, a+template+b, template)
	if report.Pairs[0].MatchedTokens != 0 {
		t.Fatalf("matched across excluded gap: %+v", report.Pairs[0])
	}
}
func TestSimilarityRequiresConsistentIdentifierMapping(t *testing.T) {
	a := lexSimilarity("x + x + x + x + x + x + x + x + x + x + x + x", "C++")
	b := lexSimilarity("a + b + a + b + a + b + a + b + a + b + a + b", "C++")
	budget := 10000
	tiles, err := matchTokenRuns(context.Background(), a, b, make([]bool, len(a)), make([]bool, len(b)), 20, true, &budget, nil, nil)
	if err != nil || len(tiles) != 0 {
		t.Fatalf("inconsistent rename accepted: %+v %v", tiles, err)
	}
}
func TestSimilarityDoesNotReuseOneCopiedBlockOrMatchShortPrograms(t *testing.T) {
	report := similarityPairReport(t, "Python", similarityExample+"\n"+similarityExample, similarityExample, "")
	pair := report.Pairs[0]
	if pair.CoverageA != 50 || pair.CoverageB != 100 || pair.Similarity != 66.67 {
		t.Fatalf("duplicate coverage: %+v", pair)
	}
	report = similarityPairReport(t, "Python", "print(input())", "print(input())", "")
	if report.Pairs[0].MatchedTokens != 0 {
		t.Fatal("short common program flagged")
	}
}
func TestSimilarityPreservesLiteralsAndIndentation(t *testing.T) {
	for _, code := range []string{"x='//not a comment'; y=\"#not a comment\";", "x = '''multi\nline\nstring'''"} {
		tokens := lexSimilarity(code, "Python")
		if len(tokens) < 2 {
			t.Fatalf("string was treated as comment: %v", tokens)
		}
	}
	tokens := lexSimilarity("text = '''a\nb\nc'''", "Python")
	last := tokens[len(tokens)-1]
	if last.line != 1 || last.endLine != 3 {
		t.Fatalf("multiline range wrong: %+v", last)
	}
	a := lexSimilarity("if x:\n    print(x)\nprint(x)", "Python")
	b := lexSimilarity("if x:\n    print(x)\n    print(x)", "Python")
	same := true
	for i := range a {
		if a[i].raw != b[i].raw {
			same = false
		}
	}
	if same {
		t.Fatal("Python nesting was discarded")
	}
	a = lexSimilarity("x=1; x=2", "C++")
	b = lexSimilarity("x=1; x=3", "C++")
	if a[len(a)-1].key == b[len(b)-1].key {
		t.Fatal("literal changes discarded")
	}
}
func TestSimilarityKeepsCodeAfterInlineImports(t *testing.T) {
	for _, c := range []struct{ language, code string }{{"Go", "package main; func main(){println(1)}"}, {"Java", "import java.util.*; class Main {}"}, {"Python", "import math; print(3)"}} {
		tokens := lexSimilarity(c.code, c.language)
		if len(tokens) < 4 {
			t.Fatalf("%s lost code after directive: %+v", c.language, tokens)
		}
	}
}
func TestSimilarityLimitsAndCancellation(t *testing.T) {
	_, err := BuildSimilarity(context.Background(), "2", "Python", "latest_per_student", "", make([]Submission, 201))
	if !errors.Is(err, ErrSimilarityLimit) {
		t.Fatalf("oversized batch: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = BuildSimilarity(ctx, "2", "Python", "selected_pair", "", []Submission{{Code: similarityExample}})
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation ignored: %v", err)
	}
	a := lexSimilarity(similarityExample, "Python")
	budget := 0
	_, err = matchTokenRuns(context.Background(), a, a, make([]bool, len(a)), make([]bool, len(a)), 20, true, &budget, nil, nil)
	if !errors.Is(err, ErrSimilarityLimit) {
		t.Fatalf("budget silently truncated results: %v", err)
	}
}
func BenchmarkSimilarityClass(b *testing.B) {
	submissions := make([]Submission, 60)
	for i := range submissions {
		submissions[i] = Submission{ID: fmt.Sprint(i + 1), StudentID: fmt.Sprint(i + 1), Code: strings.Repeat(similarityExample+"\n", 4)}
	}
	for i := 0; i < b.N; i++ {
		if _, err := BuildSimilarity(context.Background(), "2", "Python", "latest_per_student", "", submissions); err != nil {
			b.Fatal(err)
		}
	}
}
