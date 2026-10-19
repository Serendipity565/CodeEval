package domain

import (
	"context"
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
)

const SimilarityMinTokens = 20
const SimilarityMaxSubmissions = 200

var ErrSimilarityLimit = errors.New("查重规模超出限制，请缩小范围后重试")

type SimilaritySource struct {
	ID             string    `json:"id"`
	StudentID      string    `json:"studentId"`
	StudentName    string    `json:"studentName"`
	SubmittedAt    time.Time `json:"submittedAt"`
	Code           string    `json:"code"`
	TokenCount     int       `json:"tokenCount"`
	ExcludedTokens int       `json:"excludedTokens"`
}
type SimilarityRange struct {
	StartLine int `json:"startLine"`
	EndLine   int `json:"endLine"`
}
type SimilarityMatch struct {
	A      SimilarityRange `json:"a"`
	B      SimilarityRange `json:"b"`
	Tokens int             `json:"tokens"`
	Kind   string          `json:"kind"`
}
type SimilarityPair struct {
	A             string            `json:"a"`
	B             string            `json:"b"`
	Similarity    float64           `json:"similarity"`
	CoverageA     float64           `json:"coverageA"`
	CoverageB     float64           `json:"coverageB"`
	MatchedTokens int               `json:"matchedTokens"`
	Matches       []SimilarityMatch `json:"matches"`
}
type SimilarityReport struct {
	AssignmentID  string             `json:"assignmentId"`
	Language      string             `json:"language"`
	Selection     string             `json:"selection"`
	GeneratedAt   time.Time          `json:"generatedAt"`
	Version       string             `json:"version"`
	MinTokens     int                `json:"minTokens"`
	Template      string             `json:"template"`
	ComparedPairs int                `json:"comparedPairs"`
	Sources       []SimilaritySource `json:"sources"`
	Pairs         []SimilarityPair   `json:"pairs"`
}

type codeToken struct {
	raw, key      string
	line, endLine int
	identifier    bool
}
type tokenTile struct{ a, b, length int }

// BuildSimilarity uses deterministic, non-overlapping token runs. Identifiers
// may be renamed only with a consistent bijection within each matched run.
// Comments/whitespace and import/package directives are not evidence. A supplied
// template is excluded by literal token matches, never by a reference solution.
func BuildSimilarity(ctx context.Context, assignmentID, language, selection, template string, submissions []Submission) (SimilarityReport, error) {
	out := SimilarityReport{AssignmentID: assignmentID, Language: language, Selection: selection, GeneratedAt: time.Now().UTC(), Version: "token-runs-v1", MinTokens: SimilarityMinTokens, Template: template, Sources: []SimilaritySource{}, Pairs: []SimilarityPair{}}
	if len(submissions) > SimilarityMaxSubmissions || len(template) > 64000 {
		return out, ErrSimilarityLimit
	}
	tokens := make([][]codeToken, len(submissions))
	excluded := make([][]bool, len(submissions))
	budget := 12_000_000
	indexes := make([]*tokenRunIndex, len(submissions))
	base := lexSimilarity(template, language)
	if len(base) > 20000 {
		return out, ErrSimilarityLimit
	}
	total := 0
	for i, s := range submissions {
		if err := ctx.Err(); err != nil {
			return out, err
		}
		if len(s.Code) > 200000 {
			return out, ErrSimilarityLimit
		}
		tokens[i] = lexSimilarity(s.Code, language)
		total += len(tokens[i])
		if len(tokens[i]) > 20000 || total > 300000 {
			return out, ErrSimilarityLimit
		}
		excluded[i] = make([]bool, len(tokens[i]))
		if len(base) >= 8 {
			tiles, err := matchTokenRuns(ctx, tokens[i], base, excluded[i], make([]bool, len(base)), 8, false, &budget, nil, nil)
			if err != nil {
				return out, err
			}
			// Repeated uses of the same template must all be excluded. Template tokens
			// are reusable across runs, unlike evidence between student submissions.
			for _, tile := range tiles {
				for k := 0; k < tile.length; k++ {
					excluded[i][tile.a+k] = true
				}
			}
		}
		indexes[i] = buildTokenRunIndex(tokens[i], excluded[i], SimilarityMinTokens, true)
		count := 0
		for _, v := range excluded[i] {
			if v {
				count++
			}
		}
		out.Sources = append(out.Sources, SimilaritySource{ID: s.ID, StudentID: s.StudentID, StudentName: s.StudentName, SubmittedAt: s.SubmittedAt, Code: s.Code, TokenCount: len(tokens[i]) - count, ExcludedTokens: count})
	}
	for i := 0; i < len(submissions); i++ {
		for j := i + 1; j < len(submissions); j++ {
			out.ComparedPairs++
			tiles, err := matchTokenRuns(ctx, tokens[i], tokens[j], excluded[i], excluded[j], SimilarityMinTokens, true, &budget, indexes[i], indexes[j])
			if err != nil {
				return out, err
			}
			pair := SimilarityPair{A: submissions[i].ID, B: submissions[j].ID, Matches: []SimilarityMatch{}}
			for _, tile := range tiles {
				kind := "exact"
				for k := 0; k < tile.length; k++ {
					if tokens[i][tile.a+k].raw != tokens[j][tile.b+k].raw {
						kind = "renamed"
						break
					}
				}
				pair.MatchedTokens += tile.length
				pair.Matches = append(pair.Matches, SimilarityMatch{A: SimilarityRange{tokens[i][tile.a].line, tokens[i][tile.a+tile.length-1].endLine}, B: SimilarityRange{tokens[j][tile.b].line, tokens[j][tile.b+tile.length-1].endLine}, Tokens: tile.length, Kind: kind})
			}
			a, b := out.Sources[i].TokenCount, out.Sources[j].TokenCount
			if a > 0 {
				pair.CoverageA = percent(pair.MatchedTokens, a)
			}
			if b > 0 {
				pair.CoverageB = percent(pair.MatchedTokens, b)
			}
			if a+b > 0 {
				pair.Similarity = percent(2*pair.MatchedTokens, a+b)
			}
			out.Pairs = append(out.Pairs, pair)
		}
	}
	sort.SliceStable(out.Pairs, func(i, j int) bool { return out.Pairs[i].Similarity > out.Pairs[j].Similarity })
	return out, nil
}
func percent(n, d int) float64 { return math.Round(10000*float64(n)/float64(d)) / 100 }

// Rolling hashes only retrieve candidate runs. Full token and identifier checks
// below verify every candidate, so a hash collision cannot create evidence.
type tokenRunIndex struct {
	keys      []uint64
	positions map[uint64][]int
}

func buildTokenRunIndex(tokens []codeToken, ignored []bool, min int, rename bool) *tokenRunIndex {
	out := &tokenRunIndex{keys: make([]uint64, len(tokens)), positions: make(map[uint64][]int)}
	const multiplier uint64 = 1000003
	var hash, power uint64 = 0, 1
	for k := 0; k < min; k++ {
		power *= multiplier
	}
	hashes := make([]uint64, len(tokens))
	blocked := 0
	for i, t := range tokens {
		value := t.raw
		if rename {
			value = t.key
		}
		h := uint64(14695981039346656037)
		for j := 0; j < len(value); j++ {
			h ^= uint64(value[j])
			h *= 1099511628211
		}
		hashes[i] = h
		hash = hash*multiplier + h
		if ignored[i] {
			blocked++
		}
		if i >= min {
			hash -= hashes[i-min] * power
			if ignored[i-min] {
				blocked--
			}
		}
		if i+1 >= min {
			start := i + 1 - min
			out.keys[start] = hash
			if blocked == 0 {
				out.positions[hash] = append(out.positions[hash], start)
			}
		}
	}
	return out
}

func matchTokenRuns(ctx context.Context, a, b []codeToken, ignoreA, ignoreB []bool, min int, rename bool, budget *int, aIndex, bIndex *tokenRunIndex) ([]tokenTile, error) {
	tiles := []tokenTile{}
	usedA := append([]bool(nil), ignoreA...)
	usedB := append([]bool(nil), ignoreB...)
	if aIndex == nil {
		aIndex = buildTokenRunIndex(a, ignoreA, min, rename)
	}
	if bIndex == nil {
		bIndex = buildTokenRunIndex(b, ignoreB, min, rename)
	}

	for i := 0; i+min <= len(a); i++ {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		valid := true
		for k := 0; k < min; k++ {
			if usedA[i+k] {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		best := tokenTile{a: i, b: -1}
		*budget--
		if *budget < 0 {
			return nil, ErrSimilarityLimit
		}
		for _, j := range bIndex.positions[aIndex.keys[i]] {
			*budget--
			if *budget < 0 {
				return nil, ErrSimilarityLimit
			}
			if usedB[j] {
				continue
			}
			forward, backward := map[string]string{}, map[string]string{}
			length := 0
			for i+length < len(a) && j+length < len(b) && !usedA[i+length] && !usedB[j+length] {
				*budget--
				if *budget < 0 {
					return nil, ErrSimilarityLimit
				}
				if *budget%4096 == 0 {
					if err := ctx.Err(); err != nil {
						return nil, err
					}
				}
				x, y := a[i+length], b[j+length]
				if !rename {
					if x.raw != y.raw {
						break
					}
				} else {
					if x.key != y.key {
						break
					}
					if x.identifier {
						if v, ok := forward[x.raw]; ok && v != y.raw {
							break
						}
						if v, ok := backward[y.raw]; ok && v != x.raw {
							break
						}
						forward[x.raw] = y.raw
						backward[y.raw] = x.raw
					}
				}
				length++
			}
			if length >= min && length > best.length {
				best = tokenTile{i, j, length}
			}
		}
		if best.b >= 0 {
			tiles = append(tiles, best)
			for k := 0; k < best.length; k++ {
				usedA[i+k] = true
				if rename {
					usedB[best.b+k] = true
				}
			}
			i += best.length - 1
		}
	}
	return tiles, nil
}

var similarityKeywords = func() map[string]bool {
	out := map[string]bool{}
	for _, word := range strings.Fields("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield auto bool case catch char const constexpr default delete do double enum explicit export extern false final float friend goto inline int interface long namespace new nullptr operator override private protected public register short signed sizeof static struct super switch synchronized template this throw throws true typedef typename union unsigned using virtual void volatile wchar_t package func go defer chan fallthrough map range select type var nil make len cap append print println input str list dict set tuple self include define") {
		out[word] = true
	}
	return out
}()

// Lexer retains literal values, operators and original line positions. It does
// not claim AST/semantic equivalence; Python indentation is retained as tokens.
func lexSimilarity(code, language string) []codeToken {
	r := []rune(strings.ReplaceAll(code, "\r\n", "\n"))
	out := []codeToken{}
	line := 1
	lineStart := true
	python := strings.EqualFold(language, "python")
	add := func(raw string, identifier bool, startLine int) {
		key := raw
		if identifier {
			key = "@identifier"
		}
		out = append(out, codeToken{raw, key, startLine, line, identifier})
	}
	for i := 0; i < len(r); {
		if lineStart {
			end := i
			for end < len(r) && r[end] != '\n' {
				end++
			}
			trim := strings.TrimSpace(string(r[i:end]))
			if next := skipSimilarityDirective(r, i, language); next > i {
				for _, c := range r[i:next] {
					if c == '\n' {
						line++
					}
				}
				i = next
				lineStart = true
				continue
			}
			if python && trim != "" && !strings.HasPrefix(trim, "#") {
				indent := 0
				for i < len(r) && (r[i] == ' ' || r[i] == '\t') {
					if r[i] == '\t' {
						indent += 8
					} else {
						indent++
					}
					i++
				}
				add(fmt.Sprintf("@indent:%d", indent), false, line)
			}
			lineStart = false
			if i >= len(r) {
				break
			}
		}
		c := r[i]
		if c == '\n' {
			line++
			lineStart = true
			i++
			continue
		}
		if unicode.IsSpace(c) {
			i++
			continue
		}
		if python && c == '#' || !python && c == '/' && i+1 < len(r) && r[i+1] == '/' {
			for i < len(r) && r[i] != '\n' {
				i++
			}
			continue
		}
		if !python && c == '/' && i+1 < len(r) && r[i+1] == '*' {
			i += 2
			for i < len(r) {
				if i+1 < len(r) && r[i] == '*' && r[i+1] == '/' {
					i += 2
					break
				}
				if r[i] == '\n' {
					line++
				}
				i++
			}
			continue
		}
		start, startLine := i, line
		if c == '\'' || c == '"' || c == '`' {
			triple := i+2 < len(r) && r[i+1] == c && r[i+2] == c && c != '`'
			width := 1
			if triple {
				width = 3
			}
			i += width
			for i < len(r) {
				if c != '`' && r[i] == '\\' && i+1 < len(r) {
					if r[i+1] == '\n' {
						line++
					}
					i += 2
					continue
				}
				if r[i] == '\n' {
					line++
				}
				if r[i] == c {
					if !triple {
						i++
						break
					}
					if i+2 < len(r) && r[i+1] == c && r[i+2] == c {
						i += 3
						break
					}
				}
				i++
			}
			add(string(r[start:i]), false, startLine)
			continue
		}
		if unicode.IsLetter(c) || c == '_' || c == '$' {
			i++
			for i < len(r) && (unicode.IsLetter(r[i]) || unicode.IsDigit(r[i]) || r[i] == '_' || r[i] == '$') {
				i++
			}
			raw := string(r[start:i])
			add(raw, !similarityKeywords[raw], startLine)
			continue
		}
		if unicode.IsDigit(c) {
			i++
			for i < len(r) && (unicode.IsLetter(r[i]) || unicode.IsDigit(r[i]) || r[i] == '.' || r[i] == '_') {
				i++
			}
			add(string(r[start:i]), false, startLine)
			continue
		}
		i++
		if i < len(r) && strings.Contains(" == != <= >= += -= *= /= %= ++ -- && || << >> ** // := -> :: &= |= ^= ", " "+string(r[start:i+1])+" ") {
			i++
		}
		add(string(r[start:i]), false, startLine)
	}
	return out
}

// Skip only the directive, preserving executable statements after semicolons
// and line positions across parenthesized import blocks.
func skipSimilarityDirective(r []rune, start int, language string) int {
	end := start
	for end < len(r) && r[end] != '\n' {
		end++
	}
	text := strings.TrimLeftFunc(string(r[start:end]), unicode.IsSpace)
	starts := func(word string) bool { return strings.HasPrefix(text, word+" ") || strings.HasPrefix(text, word+"\t") }
	python := strings.EqualFold(language, "python")
	java := strings.EqualFold(language, "java")
	goLang := strings.EqualFold(language, "go")
	if strings.EqualFold(language, "c++") && strings.HasPrefix(text, "#include") {
		return end
	}
	if !(python && (starts("import") || starts("from")) || (java || goLang) && (starts("import") || starts("package"))) {
		return start
	}
	depth := 0
	quote := rune(0)
	for i := start; i < len(r); i++ {
		c := r[i]
		if quote != 0 {
			if c == '\\' {
				i++
				continue
			}
			if c == quote {
				quote = 0
			}
			continue
		}
		if c == '"' || c == '\'' || c == '`' {
			quote = c
			continue
		}
		if c == '(' {
			depth++
		}
		if c == ')' {
			depth--
			if depth == 0 {
				return i + 1
			}
		}
		if c == ';' && depth == 0 {
			return i + 1
		}
		if c == '\n' && depth == 0 && !java {
			return i
		}
	}
	return len(r)
}
