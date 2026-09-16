package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSandboxDefaultsForSmallServer(t *testing.T) {
	path := writeConfig(t, "jwt:\n  secret: test-secret\n")
	cfg, err := Load(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Sandbox.MaxConcurrentSandboxes != 1 || cfg.Sandbox.MaxAttempts != 2 || len(cfg.Sandbox.SupportedLanguages) != 4 {
		t.Fatalf("unexpected sandbox defaults: %+v", cfg.Sandbox)
	}
}

func TestSandboxRejectsExcessiveConcurrency(t *testing.T) {
	path := writeConfig(t, "jwt:\n  secret: test-secret\nsandbox:\n  max_concurrent_sandboxes: 3\n")
	if _, err := Load(path); err == nil {
		t.Fatal("expected excessive sandbox concurrency to be rejected")
	}
}

func TestEnabledSandboxRequiresRunner(t *testing.T) {
	path := writeConfig(t, "jwt:\n  secret: test-secret\nsandbox:\n  enabled: true\n")
	if _, err := Load(path); err == nil {
		t.Fatal("expected enabled sandbox without runner configuration to fail")
	}
}

func writeConfig(t *testing.T, contents string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
