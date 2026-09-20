package main

import (
	"slices"
	"testing"
)

func TestDockerRunArgsMountsExecutableTmpfs(t *testing.T) {
	args := dockerRunArgs("sandbox-image")
	want := "/tmp:rw,exec,nosuid,nodev,size=192m,mode=1777"
	if !slices.Contains(args, want) {
		t.Fatalf("docker arguments must explicitly allow compiled programs to execute on /tmp: %q", args)
	}
	if got := args[len(args)-1]; got != "sandbox-image" {
		t.Fatalf("image must be the final argument, got %q", got)
	}
	assertOptionValue(t, args, "--memory", "512m")
	assertOptionValue(t, args, "--memory-swap", "512m")
}

func assertOptionValue(t *testing.T, args []string, option, want string) {
	t.Helper()
	for index := 0; index+1 < len(args); index++ {
		if args[index] == option {
			if got := args[index+1]; got != want {
				t.Fatalf("%s must be %s, got %s", option, want, got)
			}
			return
		}
	}
	t.Fatalf("missing Docker option %s", option)
}
