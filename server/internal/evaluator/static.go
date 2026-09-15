package evaluator

import (
	"encoding/json"
	"strings"
	"unicode"
)

// StaticEvidence contains cheap, deterministic observations. These are evidence
// for the reviewer, not proof that the submitted program is functionally correct.
type StaticEvidence struct {
	Language      string   `json:"language"`
	NonEmptyLines int      `json:"nonEmptyLines"`
	CommentLines  int      `json:"commentLines"`
	MaxLineLength int      `json:"maxLineLength"`
	BranchCount   int      `json:"branchCount"`
	LoopCount     int      `json:"loopCount"`
	FunctionHints int      `json:"functionHints"`
	Warnings      []string `json:"warnings"`
	Limitations   []string `json:"limitations"`
}

func AnalyzeStatic(language, code string) StaticEvidence {
	report := StaticEvidence{Language: language, Warnings: []string{}, Limitations: []string{
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
	return report
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
