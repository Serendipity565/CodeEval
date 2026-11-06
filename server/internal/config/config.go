package config

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"os"
	"strings"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		Port        int      `yaml:"port"`
		CORSOrigins []string `yaml:"cors_origins"`
	} `yaml:"server"`
	Database struct {
		Host                   string `yaml:"host"`
		Port                   int    `yaml:"port"`
		Name                   string `yaml:"name"`
		Username               string `yaml:"username"`
		Password               string `yaml:"password"`
		Charset                string `yaml:"charset"`
		MaxIdleConns           int    `yaml:"max_idle_conns"`
		MaxOpenConns           int    `yaml:"max_open_conns"`
		ConnMaxLifetimeMinutes int    `yaml:"conn_max_lifetime_minutes"`
	} `yaml:"database"`
	JWT struct {
		Secret       string `yaml:"secret"`
		ExpiresHours int    `yaml:"expires_hours"`
	} `yaml:"jwt"`
	Seed struct {
		Enabled bool `yaml:"enabled"`
	} `yaml:"seed"`
	DeepSeek struct {
		BaseURL      string `yaml:"base_url"`
		APIKey       string `yaml:"api_key"`
		Model        string `yaml:"model"`
		TimeoutSecs  int    `yaml:"timeout_seconds"`
		MaxTokens    int    `yaml:"max_tokens"`
		MaxCodeBytes int    `yaml:"max_code_bytes"`
	} `yaml:"deepseek"`
	AIDetection struct {
		Provider    string `yaml:"provider"`
		Model       string `yaml:"model"`
		URL         string `yaml:"url"`
		Token       string `yaml:"-"`
		TimeoutSecs int    `yaml:"timeout_seconds"`
		CPUThreads  int    `yaml:"cpu_threads"`
		Device      string `yaml:"device"`
	} `yaml:"ai_detection"`
	Sandbox struct {
		Enabled                bool     `yaml:"enabled"`
		MaxConcurrentSandboxes int      `yaml:"max_concurrent_sandboxes"`
		SupportedLanguages     []string `yaml:"supported_languages"`
		QueuePollIntervalMS    int      `yaml:"queue_poll_interval_ms"`
		JobTimeoutSeconds      int      `yaml:"job_timeout_seconds"`
		MaxAttempts            int      `yaml:"max_attempts"`
		RunnerURL              string   `yaml:"runner_url"`
		RunnerToken            string   `yaml:"runner_token"`
	} `yaml:"sandbox"`
}

func Load(path string) (Config, error) {
	var cfg Config
	b, err := os.ReadFile(path)
	if err != nil {
		return cfg, fmt.Errorf("read config %q: %w", path, err)
	}
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		return cfg, fmt.Errorf("parse config: %w", err)
	}
	if cfg.Server.Port == 0 {
		cfg.Server.Port = 8080
	}
	if cfg.Database.Charset == "" {
		cfg.Database.Charset = "utf8mb4"
	}
	if cfg.Database.MaxIdleConns == 0 {
		cfg.Database.MaxIdleConns = 5
	}
	if cfg.Database.MaxOpenConns == 0 {
		cfg.Database.MaxOpenConns = 20
	}
	if cfg.Database.ConnMaxLifetimeMinutes == 0 {
		cfg.Database.ConnMaxLifetimeMinutes = 30
	}
	if cfg.JWT.ExpiresHours == 0 {
		cfg.JWT.ExpiresHours = 24
	}
	if cfg.JWT.Secret == "" {
		return cfg, fmt.Errorf("jwt.secret must be configured")
	}
	if cfg.DeepSeek.BaseURL == "" {
		cfg.DeepSeek.BaseURL = "https://api.deepseek.com"
	}
	if cfg.DeepSeek.Model == "" {
		cfg.DeepSeek.Model = "deepseek-v4-flash"
	}
	if cfg.DeepSeek.TimeoutSecs == 0 {
		cfg.DeepSeek.TimeoutSecs = 60
	}
	if cfg.DeepSeek.MaxTokens == 0 {
		cfg.DeepSeek.MaxTokens = 4096
	}
	if cfg.DeepSeek.MaxCodeBytes == 0 {
		cfg.DeepSeek.MaxCodeBytes = 100000
	}
	cfg.AIDetection.Provider = strings.ToLower(strings.TrimSpace(cfg.AIDetection.Provider))
	if cfg.AIDetection.Provider == "" {
		cfg.AIDetection.Provider = "auto"
	}
	if cfg.AIDetection.Provider == "ds" {
		cfg.AIDetection.Provider = "deepseek"
	}
	if cfg.AIDetection.Provider == "llmsniffer" {
		cfg.AIDetection.Provider = "droiddetect"
	}
	if cfg.AIDetection.Provider != "deepseek" && cfg.AIDetection.Provider != "auto" && cfg.AIDetection.Provider != "droiddetect" {
		return cfg, fmt.Errorf("ai_detection.provider must be deepseek, auto or droiddetect")
	}
	cfg.AIDetection.Model = strings.ToLower(strings.TrimSpace(cfg.AIDetection.Model))
	if cfg.AIDetection.Model == "" {
		cfg.AIDetection.Model = "base"
	}
	if cfg.AIDetection.Model != "base" && cfg.AIDetection.Model != "large" {
		return cfg, fmt.Errorf("ai_detection.model must be base or large")
	}
	if cfg.AIDetection.TimeoutSecs == 0 {
		cfg.AIDetection.TimeoutSecs = 180
	}
	if cfg.AIDetection.TimeoutSecs < 1 || cfg.AIDetection.TimeoutSecs > 1800 {
		return cfg, fmt.Errorf("ai_detection.timeout_seconds must be between 1 and 1800")
	}
	if cfg.AIDetection.URL == "" || cfg.AIDetection.URL == "http://llmsniffer:8010" {
		cfg.AIDetection.URL = "http://droiddetect:8010"
	}
	if cfg.AIDetection.CPUThreads == 0 {
		cfg.AIDetection.CPUThreads = 4
	}
	if cfg.AIDetection.CPUThreads < 1 || cfg.AIDetection.CPUThreads > 32 {
		return cfg, fmt.Errorf("ai_detection.cpu_threads must be between 1 and 32")
	}
	cfg.AIDetection.Device = strings.ToLower(strings.TrimSpace(cfg.AIDetection.Device))
	if cfg.AIDetection.Device == "" {
		cfg.AIDetection.Device = "cuda"
	}
	if cfg.AIDetection.Device != "cuda" && cfg.AIDetection.Device != "cpu" && cfg.AIDetection.Device != "auto" {
		return cfg, fmt.Errorf("ai_detection.device must be cuda, cpu or auto")
	}
	// The two services share config.yaml. Derive an internal credential rather
	// than requiring an additional secret, env file or Compose interpolation.
	mac := hmac.New(sha256.New, []byte(cfg.JWT.Secret))
	mac.Write([]byte("codeeval-local-detector-v1"))
	cfg.AIDetection.Token = hex.EncodeToString(mac.Sum(nil))
	if cfg.AIDetection.Provider != "deepseek" {
		u, parseErr := url.Parse(cfg.AIDetection.URL)
		if parseErr != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
			return cfg, fmt.Errorf("local detector requires an HTTP(S) ai_detection.url")
		}
	}
	if cfg.Sandbox.MaxConcurrentSandboxes == 0 {
		cfg.Sandbox.MaxConcurrentSandboxes = 1
	}
	if cfg.Sandbox.MaxConcurrentSandboxes < 1 || cfg.Sandbox.MaxConcurrentSandboxes > 2 {
		return cfg, fmt.Errorf("sandbox.max_concurrent_sandboxes must be 1 or 2 on this deployment")
	}
	if len(cfg.Sandbox.SupportedLanguages) == 0 {
		cfg.Sandbox.SupportedLanguages = []string{"Go", "Python", "Java", "C++"}
	}
	if cfg.Sandbox.QueuePollIntervalMS == 0 {
		cfg.Sandbox.QueuePollIntervalMS = 30000
	}
	if cfg.Sandbox.QueuePollIntervalMS < 1000 {
		return cfg, fmt.Errorf("sandbox.queue_poll_interval_ms must be at least 1000")
	}
	if cfg.Sandbox.JobTimeoutSeconds == 0 {
		cfg.Sandbox.JobTimeoutSeconds = 180
	}
	if cfg.Sandbox.JobTimeoutSeconds < 30 {
		return cfg, fmt.Errorf("sandbox.job_timeout_seconds must be at least 30")
	}
	if cfg.Sandbox.MaxAttempts == 0 {
		cfg.Sandbox.MaxAttempts = 2
	}
	if cfg.Sandbox.MaxAttempts < 1 || cfg.Sandbox.MaxAttempts > 5 {
		return cfg, fmt.Errorf("sandbox.max_attempts must be between 1 and 5")
	}
	if cfg.Sandbox.Enabled && (strings.TrimSpace(cfg.Sandbox.RunnerURL) == "" || strings.TrimSpace(cfg.Sandbox.RunnerToken) == "") {
		return cfg, fmt.Errorf("sandbox.runner_url and sandbox.runner_token are required when sandbox is enabled")
	}
	seenLanguages := map[string]bool{}
	for _, language := range cfg.Sandbox.SupportedLanguages {
		normalized := strings.ToLower(strings.TrimSpace(language))
		if normalized == "" || seenLanguages[normalized] {
			return cfg, fmt.Errorf("sandbox.supported_languages must contain unique non-empty names")
		}
		seenLanguages[normalized] = true
	}
	return cfg, nil
}
