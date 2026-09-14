package config

import (
	"fmt"
	"os"
	"strconv"

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
	if v := os.Getenv("CODEEVAL_DB_PASSWORD"); v != "" {
		cfg.Database.Password = v
	}
	if v := os.Getenv("CODEEVAL_DB_HOST"); v != "" {
		cfg.Database.Host = v
	}
	if v := os.Getenv("CODEEVAL_DB_PORT"); v != "" {
		if port, err := strconv.Atoi(v); err == nil {
			cfg.Database.Port = port
		}
	}
	if v := os.Getenv("CODEEVAL_DB_NAME"); v != "" {
		cfg.Database.Name = v
	}
	if v := os.Getenv("CODEEVAL_DB_USERNAME"); v != "" {
		cfg.Database.Username = v
	}
	if v := os.Getenv("CODEEVAL_JWT_SECRET"); v != "" {
		cfg.JWT.Secret = v
	}
	if v := os.Getenv("CODEEVAL_DEEPSEEK_API_KEY"); v != "" {
		cfg.DeepSeek.APIKey = v
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
	return cfg, nil
}
