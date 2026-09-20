package main

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"testing"
	"time"

	"codeeval/sandbox/protocol"
)

func TestSandboxImagesEndToEnd(t *testing.T) {
	if os.Getenv("CODEEVAL_DOCKER_TEST") != "1" {
		t.Skip("set CODEEVAL_DOCKER_TEST=1 to run Docker sandbox integration tests")
	}
	tests := []struct {
		language, image, code string
	}{
		{"Go", "codeeval-sandbox-go:local", "package main\nimport \"fmt\"\nfunc main(){var n int; fmt.Scan(&n); fmt.Println(n*2)}"},
		{"Python", "codeeval-sandbox-python:local", "n = int(input())\nprint(n * 2)"},
		{"Java", "codeeval-sandbox-java:local", "import java.util.*; public class Main { public static void main(String[] args) { Scanner s = new Scanner(System.in); System.out.println(s.nextInt() * 2); } }"},
		{"C++", "codeeval-sandbox-cpp:local", "#include <iostream>\nint main(){int n; std::cin >> n; std::cout << n * 2 << '\\n';}"},
	}
	for _, test := range tests {
		t.Run(test.language, func(t *testing.T) {
			request := protocol.Request{Language: test.language, Code: test.code, Tests: []protocol.TestCase{{Name: "double", Input: "21\n", Expected: "42\n", Weight: 1, TimeoutMS: 3000}}}
			payload, err := json.Marshal(request)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "docker", dockerRunArgs(test.image)...)
			cmd.Stdin = bytes.NewReader(payload)
			output, err := cmd.CombinedOutput()
			if err != nil {
				t.Fatalf("run sandbox image: %v\n%s", err, output)
			}
			var response protocol.Response
			if err := json.Unmarshal(output, &response); err != nil {
				t.Fatalf("decode response: %v\n%s", err, output)
			}
			if !response.CompileOK || response.Passed != 1 || response.PassedWeight != 1 {
				t.Fatalf("unexpected response: %+v", response)
			}
		})
	}
}
