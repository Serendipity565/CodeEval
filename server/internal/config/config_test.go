package config

import (
	"os"
	"path/filepath"
	"strings"
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

func TestDetectorReadsSharedYAMLAndDerivesInternalToken(t *testing.T) {
	cfg, err := Load(writeConfig(t, "jwt:\n  secret: test-secret\nai_detection:\n  provider: auto\n  timeout_seconds: 240\n  cpu_threads: 6\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AIDetection.Provider != "auto" || cfg.AIDetection.Model != "base" || cfg.AIDetection.URL != "http://droiddetect:8010" || cfg.AIDetection.TimeoutSecs != 240 || cfg.AIDetection.CPUThreads != 6 || cfg.AIDetection.Device != "cuda" || len(cfg.AIDetection.Token) != 64 {
		t.Fatalf("unexpected detector settings: %+v", cfg.AIDetection)
	}
}

func TestDetectorModelSelection(t *testing.T) {
	for _, model := range []string{"base", "large", " LARGE "} {
		cfg, err := Load(writeConfig(t, "jwt:\n  secret: test-secret\nai_detection:\n  model: '"+model+"'\n"))
		if err != nil || cfg.AIDetection.Model != strings.ToLower(strings.TrimSpace(model)) {
			t.Fatalf("model selection failed: %q, %v", cfg.AIDetection.Model, err)
		}
	}
	if _, err := Load(writeConfig(t, "jwt:\n  secret: test-secret\nai_detection:\n  model: unknown\n")); err == nil {
		t.Fatal("unknown model accepted")
	}
}

func TestDetectorRejectsInvalidDevice(t *testing.T) {
	_, err := Load(writeConfig(t, "jwt:\n  secret: test-secret\nai_detection:\n  device: invalid\n"))
	if err == nil {
		t.Fatal("expected unknown inference device to be rejected")
	}
}

func TestDetectorAcceptsDSAliasWithoutLocalService(t *testing.T) {
	cfg, err := Load(writeConfig(t, "jwt:\n  secret: test-secret\nai_detection:\n  provider: ds\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AIDetection.Provider != "deepseek" {
		t.Fatalf("DS alias was not normalized: %s", cfg.AIDetection.Provider)
	}
}

func TestDetectorRejectsInvalidLocalURL(t *testing.T) {
	_, err := Load(writeConfig(t, "jwt:\n  secret: test-secret\nai_detection:\n  provider: auto\n  url: file:///models\n"))
	if err == nil {
		t.Fatal("expected non-HTTP local URL to be rejected")
	}
}

func TestLegacyLocalDetectorConfigMigratesToDroidDetect(t *testing.T) {
	cfg, err := Load(writeConfig(t, "jwt:\n  secret: test-secret\nai_detection:\n  provider: llmsniffer\n  url: http://llmsniffer:8010\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AIDetection.Provider != "droiddetect" || cfg.AIDetection.URL != "http://droiddetect:8010" {
		t.Fatalf("legacy detector config was not migrated: %+v", cfg.AIDetection)
	}
}
