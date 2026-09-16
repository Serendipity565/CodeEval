package config

import (
	"fmt"
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
		cfg.Sandbox.QueuePollIntervalMS = 1000
	}
	if cfg.Sandbox.QueuePollIntervalMS < 100 {
		return cfg, fmt.Errorf("sandbox.queue_poll_interval_ms must be at least 100")
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
