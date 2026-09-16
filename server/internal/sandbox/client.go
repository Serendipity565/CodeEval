package sandbox

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"codeeval/server/internal/domain"
)

type Client struct {
	enabled    bool
	url, token string
	http       *http.Client
}

func New(enabled bool, url, token string, timeout time.Duration) *Client {
	return &Client{enabled: enabled, url: strings.TrimRight(url, "/"), token: token, http: &http.Client{Timeout: timeout}}
}

func (c *Client) Run(ctx context.Context, language, code string, tests []domain.TestCase) (*domain.ExecutionEvidence, error) {
	if !c.enabled || len(tests) == 0 {
		return nil, nil
	}
	payload, err := json.Marshal(map[string]any{"language": language, "code": code, "tests": tests})
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.url+"/v1/run", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+c.token)
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("sandbox runner: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("sandbox runner returned %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}
	var result domain.ExecutionEvidence
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("decode sandbox result: %w", err)
	}
	if err := redactTestResults(&result, tests); err != nil {
		return nil, err
	}
	return &result, nil
}

func redactTestResults(result *domain.ExecutionEvidence, tests []domain.TestCase) error {
	for i := range result.Results {
		if i >= len(tests) {
			return fmt.Errorf("sandbox returned more test results than requested")
		}
		test := tests[i]
		result.Results[i].Hidden = test.Hidden
		if test.Hidden {
			result.Results[i].Input, result.Results[i].Expected, result.Results[i].Actual = "", "", ""
			switch result.Results[i].Error {
			case "", "output mismatch", "time limit exceeded":
			default:
				result.Results[i].Error = "runtime error"
			}
		} else {
			result.Results[i].Input = test.Input
			result.Results[i].Expected = test.Expected
		}
	}
	return nil
}
