package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"codeeval/sandbox/protocol"
)

func main() {
	var request protocol.Request
	if err := json.NewDecoder(os.Stdin).Decode(&request); err != nil {
		fail(err)
	}
	language := strings.ToLower(os.Getenv("SANDBOX_LANGUAGE"))
	file, compile, run, err := commands(language)
	if err != nil {
		fail(err)
	}
	dir, err := os.MkdirTemp("/tmp", "codeeval-")
	if err != nil {
		fail(err)
	}
	defer os.RemoveAll(dir)
	if err := os.WriteFile(filepath.Join(dir, file), []byte(request.Code), 0600); err != nil {
		fail(err)
	}
	response := protocol.Response{Language: request.Language, Total: len(request.Tests), Results: make([]protocol.TestResult, 0, len(request.Tests))}
	for _, test := range request.Tests {
		response.TotalWeight += test.Weight
	}
	if len(compile) > 0 {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		cmd := exec.CommandContext(ctx, compile[0], compile[1:]...)
		cmd.Dir = dir
		output, compileErr := cmd.CombinedOutput()
		cancel()
		if compileErr != nil {
			response.CompileError = limited(output, compileErr)
			emit(response)
			return
		}
	}
	response.CompileOK = true
	for _, test := range request.Tests {
		started := time.Now()
		timeout := time.Duration(test.TimeoutMS) * time.Millisecond
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		cmd := exec.CommandContext(ctx, run[0], run[1:]...)
		cmd.Dir = dir
		cmd.Stdin = strings.NewReader(test.Input)
		var stdout, stderr bytes.Buffer
		cmd.Stdout = &stdout
		cmd.Stderr = &stderr
		err := cmd.Run()
		cancel()
		exit := 0
		message := ""
		if err != nil {
			exit = -1
			if ee, ok := err.(*exec.ExitError); ok {
				exit = ee.ExitCode()
			}
			message = limited(stderr.Bytes(), err)
		}
		if ctx.Err() == context.DeadlineExceeded {
			message = "time limit exceeded"
		}
		actual := normalize(stdout.String())
		passed := err == nil && actual == normalize(test.Expected)
		if err == nil && !passed {
			message = "output mismatch"
		}
		if passed {
			response.Passed++
			response.PassedWeight += test.Weight
		}
		visibleActual := ""
		if !test.Hidden {
			visibleActual = truncate(actual, 4000)
		}
		response.Results = append(response.Results, protocol.TestResult{Name: test.Name, Passed: passed, Actual: visibleActual, ExitCode: exit, DurationMS: time.Since(started).Milliseconds(), Error: message})
	}
	emit(response)
}

func commands(language string) (string, []string, []string, error) {
	switch language {
	case "go":
		return "main.go", []string{"go", "build", "-o", "program", "main.go"}, []string{"./program"}, nil
	case "python":
		return "main.py", nil, []string{"python3", "main.py"}, nil
	case "java":
		return "Main.java", []string{"javac", "Main.java"}, []string{"java", "-cp", ".", "Main"}, nil
	case "cpp":
		return "main.cpp", []string{"g++", "-O2", "-std=c++17", "-o", "program", "main.cpp"}, []string{"./program"}, nil
	default:
		return "", nil, nil, fmt.Errorf("unsupported language")
	}
}
func normalize(value string) string {
	return strings.TrimSpace(strings.ReplaceAll(value, "\r\n", "\n"))
}
func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit] + "\n…（输出已截断）"
}
func limited(output []byte, err error) string {
	text := strings.TrimSpace(string(output))
	if len(text) > 4000 {
		text = text[:4000]
	}
	if text == "" {
		text = err.Error()
	}
	return text
}
func emit(value any) { _ = json.NewEncoder(os.Stdout).Encode(value) }
func fail(err error) { fmt.Fprintln(os.Stderr, err); os.Exit(2) }
