package main

import (
	"strings"
	"testing"
	"time"
)

func TestCompileTimeoutAllowsColdToolchainStartup(t *testing.T) {
	if compileTimeout < 60*time.Second {
		t.Fatalf("compile timeout is too short for an uncached sandbox toolchain: %s", compileTimeout)
	}
}

func TestCommandsCoverEverySupportedLanguage(t *testing.T) {
	tests := map[string]struct {
		file, compiler, runtime string
	}{
		"go":     {"main.go", "go", "./program"},
		"python": {"main.py", "", "python3"},
		"java":   {"Main.java", "javac", "java"},
		"cpp":    {"main.cpp", "g++", "./program"},
	}
	for language, want := range tests {
		file, compile, run, err := commands(language)
		if err != nil {
			t.Fatalf("commands(%q): %v", language, err)
		}
		if file != want.file || first(compile) != want.compiler || first(run) != want.runtime {
			t.Errorf("commands(%q) = file %q, compile %q, run %q", language, file, compile, run)
		}
	}
}

func TestCappedBufferKeepsAcceptingWritesWithoutGrowing(t *testing.T) {
	buffer := &cappedBuffer{limit: 8}
	input := strings.Repeat("x", 32)
	written, err := buffer.Write([]byte(input))
	if err != nil || written != len(input) {
		t.Fatalf("Write() = %d, %v; want %d, nil", written, err, len(input))
	}
	if got := buffer.Len(); got != 8 {
		t.Fatalf("buffer length = %d, want 8", got)
	}
}

func first(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
