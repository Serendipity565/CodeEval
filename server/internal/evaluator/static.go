package evaluator

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"unicode"
)

// StaticEvidence contains cheap, deterministic observations. These are evidence
// for the reviewer, not proof that the submitted program is functionally correct.
type StaticEvidence struct {
	Language       string   `json:"language"`
	NonEmptyLines  int      `json:"nonEmptyLines"`
	CommentLines   int      `json:"commentLines"`
	MaxLineLength  int      `json:"maxLineLength"`
	BranchCount    int      `json:"branchCount"`
	LoopCount      int      `json:"loopCount"`
	FunctionHints  int      `json:"functionHints"`
	CyclomaticHint int      `json:"cyclomaticHint"`
	SyntaxChecked  bool     `json:"syntaxChecked"`
	SyntaxValid    bool     `json:"syntaxValid"`
	SyntaxErrors   []string `json:"syntaxErrors"`
	Warnings       []string `json:"warnings"`
	Limitations    []string `json:"limitations"`
}

func AnalyzeStatic(language, code string) StaticEvidence {
	report := StaticEvidence{Language: language, SyntaxErrors: []string{}, Warnings: []string{}, Limitations: []string{
		"未编译或执行代码，不能据此证明功能正确性",
		"计数来自语言无关的词法扫描，可能包含注释或字符串中的关键字",
	}}
	for _, line := range strings.Split(strings.ReplaceAll(code, "\r\n", "\n"), "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		report.NonEmptyLines++
		if len([]rune(line)) > report.MaxLineLength {
			report.MaxLineLength = len([]rune(line))
		}
		if strings.HasPrefix(trimmed, "//") || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "/*") || strings.HasPrefix(trimmed, "*") {
			report.CommentLines++
		}
	}
	words := tokenize(code)
	for _, word := range words {
		switch word {
		case "if", "else", "switch", "case", "match", "catch", "except":
			report.BranchCount++
		case "for", "while", "do":
			report.LoopCount++
		case "func", "function", "def":
			report.FunctionHints++
		}
	}
	lower := strings.ToLower(code)
	if strings.Contains(lower, "todo") || strings.Contains(lower, "fixme") {
		report.Warnings = append(report.Warnings, "包含 TODO/FIXME，提交可能尚未完成")
	}
	if report.MaxLineLength > 140 {
		report.Warnings = append(report.Warnings, "存在超过 140 字符的长行，可读性可能较差")
	}
	if report.NonEmptyLines >= 30 && report.CommentLines == 0 {
		report.Warnings = append(report.Warnings, "较长代码中未检测到独立注释行")
	}
	if strings.Contains(lower, "eval(") || strings.Contains(lower, "exec(") || strings.Contains(lower, "system(") {
		report.Warnings = append(report.Warnings, "检测到动态执行或系统命令调用，需要人工检查安全性")
	}
	if strings.EqualFold(strings.TrimSpace(language), "go") {
		analyzeGoSyntax(code, &report)
	}
	return report
}

func analyzeGoSyntax(code string, report *StaticEvidence) {
	report.SyntaxChecked = true
	report.SyntaxValid = true
	source := code
	if !strings.Contains(code, "package ") {
		source = "package main\n" + code
	}
	file, err := parser.ParseFile(token.NewFileSet(), "submission.go", source, parser.AllErrors|parser.ParseComments)
	if err != nil {
		report.SyntaxValid = false
		report.SyntaxErrors = append(report.SyntaxErrors, err.Error())
		report.Warnings = append(report.Warnings, "Go 语法解析失败："+err.Error())
	}
	if file == nil {
		return
	}
	report.FunctionHints = 0
	report.BranchCount = 0
	report.LoopCount = 0
	complexity := 1
	ast.Inspect(file, func(node ast.Node) bool {
		switch node.(type) {
		case *ast.FuncDecl:
			report.FunctionHints++
		case *ast.IfStmt, *ast.CaseClause, *ast.CommClause:
			report.BranchCount++
			complexity++
		case *ast.ForStmt, *ast.RangeStmt:
			report.LoopCount++
			complexity++
		case *ast.BinaryExpr:
			expr := node.(*ast.BinaryExpr)
			if expr.Op == token.LAND || expr.Op == token.LOR {
				complexity++
			}
		}
		return true
	})
	report.CyclomaticHint = complexity
}

func (s StaticEvidence) JSON() string {
	b, _ := json.Marshal(s)
	return string(b)
}

func tokenize(code string) []string {
	return strings.FieldsFunc(strings.ToLower(code), func(r rune) bool {
		return !(unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_')
	})
}
