package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"time"

	"codeeval/sandbox/protocol"
)

type runner struct {
	token   string
	timeout time.Duration
	slots   chan struct{}
	images  map[string]string
}

func main() {
	max := envInt("MAX_CONCURRENT_SANDBOXES", 1)
	if max < 1 || max > 2 {
		log.Fatal("MAX_CONCURRENT_SANDBOXES must be 1 or 2")
	}
	r := &runner{token: mustEnv("RUNNER_TOKEN"), timeout: time.Duration(envInt("JOB_TIMEOUT_SECONDS", 180)) * time.Second, slots: make(chan struct{}, max), images: map[string]string{"go": "codeeval-sandbox-go:local", "python": "codeeval-sandbox-python:local", "java": "codeeval-sandbox-java:local", "c++": "codeeval-sandbox-cpp:local"}}
	http.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusNoContent) })
	http.HandleFunc("/v1/run", r.run)
	log.Fatal(http.ListenAndServe(":8090", nil))
}

func (r *runner) run(w http.ResponseWriter, req *http.Request) {
	if req.Method != http.MethodPost {
		http.Error(w, "method not allowed", 405)
		return
	}
	if req.Header.Get("Authorization") != "Bearer "+r.token {
		http.Error(w, "unauthorized", 401)
		return
	}
	var input protocol.Request
	if err := json.NewDecoder(io.LimitReader(req.Body, 1<<20)).Decode(&input); err != nil {
		http.Error(w, "invalid request", 400)
		return
	}
	key := strings.ToLower(strings.TrimSpace(input.Language))
	image, ok := r.images[key]
	if !ok || len(input.Code) == 0 || len(input.Tests) == 0 || len(input.Tests) > 100 {
		http.Error(w, "unsupported or empty job", 400)
		return
	}
	for _, test := range input.Tests {
		if test.TimeoutMS < 100 || test.TimeoutMS > 10000 || test.Weight < 1 {
			http.Error(w, "invalid test limits", 400)
			return
		}
	}
	select {
	case r.slots <- struct{}{}:
		defer func() { <-r.slots }()
	case <-req.Context().Done():
		return
	}
	ctx, cancel := context.WithTimeout(req.Context(), r.timeout)
	defer cancel()
	payload, _ := json.Marshal(input)
	args := []string{"run", "--rm", "-i", "--network", "none", "--read-only", "--memory", "256m", "--memory-swap", "256m", "--cpus", "0.75", "--pids-limit", "64", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--tmpfs", "/tmp:rw,nosuid,size=96m", image}
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdin = bytes.NewReader(payload)
	output, err := cmd.CombinedOutput()
	if err != nil {
		http.Error(w, fmt.Sprintf("sandbox failed: %s", limit(output, err)), 502)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write(output)
}
func envInt(key string, fallback int) int {
	if n, err := strconv.Atoi(os.Getenv(key)); err == nil && n > 0 {
		return n
	}
	return fallback
}
func mustEnv(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("%s is required", key)
	}
	return value
}
func limit(output []byte, err error) string {
	value := strings.TrimSpace(string(output))
	if len(value) > 4000 {
		value = value[:4000]
	}
	if value == "" {
		value = err.Error()
	}
	return value
}
