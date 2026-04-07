package cli

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
)

// Default daemon address.
const defaultDaemonAddr = "http://localhost:7778"

// APIClient communicates with the Rioku daemon REST API.
type APIClient struct {
	BaseURL    string
	Token      string
	HTTPClient *http.Client
}

// newAPIClient creates an APIClient from global CLI flags and environment.
func newAPIClient() *APIClient {
	baseURL := flagDaemonAddr
	if baseURL == "" {
		baseURL = os.Getenv("RIOKU_DAEMON_ADDR")
	}
	if baseURL == "" {
		baseURL = defaultDaemonAddr
	}
	// Ensure no trailing slash.
	baseURL = strings.TrimRight(baseURL, "/")

	token := flagToken
	if token == "" {
		token = os.Getenv("RIOKU_TOKEN")
	}

	return &APIClient{
		BaseURL: baseURL,
		Token:   token,
		HTTPClient: &http.Client{
			Timeout: flagTimeout,
		},
	}
}

// Get sends a GET request and returns the response body.
func (c *APIClient) Get(ctx context.Context, path string) ([]byte, error) {
	return c.do(ctx, http.MethodGet, path, nil)
}

// Post sends a POST request with a JSON body and returns the response body.
func (c *APIClient) Post(ctx context.Context, path string, body any) ([]byte, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("marshal request: %w", err)
	}
	return c.do(ctx, http.MethodPost, path, data)
}

// Delete sends a DELETE request.
func (c *APIClient) Delete(ctx context.Context, path string) error {
	_, err := c.do(ctx, http.MethodDelete, path, nil)
	return err
}

func (c *APIClient) do(ctx context.Context, method, path string, body []byte) ([]byte, error) {
	url := c.BaseURL + path

	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}

	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("create request: %w", err)
	}

	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.Token)
	}

	resp, err := c.HTTPClient.Do(req)
	if err != nil {
		fmt.Fprintf(os.Stderr, "error: cannot reach daemon at %s\n", c.BaseURL)
		os.Exit(ExitDaemonUnreachable)
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	// Handle error responses.
	if resp.StatusCode >= 400 {
		return nil, parseAPIError(resp.StatusCode, respBody)
	}

	return respBody, nil
}

// parseAPIError parses an RFC 7807 ProblemDetail response into a user-friendly error.
func parseAPIError(status int, body []byte) error {
	var problem struct {
		Title  string `json:"title"`
		Detail string `json:"detail"`
		Status int    `json:"status"`
	}
	if err := json.Unmarshal(body, &problem); err == nil && problem.Detail != "" {
		return fmt.Errorf("%s (HTTP %d)", problem.Detail, status)
	}
	return fmt.Errorf("HTTP %d: %s", status, string(body))
}

// requireLocalNode checks that the command is not being pointed at a remote daemon.
// Node-local commands (init, start, stop, migrate) must run on the node directly.
func requireLocalNode(cmdName string) error {
	addr := flagDaemonAddr
	if addr == "" {
		addr = os.Getenv("RIOKU_DAEMON_ADDR")
	}
	if addr != "" && addr != defaultDaemonAddr && !isLocalAddr(addr) {
		return fmt.Errorf("'rku %s' must be run directly on the Rioku node, not remotely\n"+
			"  You are targeting: %s\n"+
			"  This command requires local access to the node's filesystem and processes",
			cmdName, addr)
	}
	return nil
}

func isLocalAddr(addr string) bool {
	lower := strings.ToLower(addr)
	return strings.Contains(lower, "localhost") ||
		strings.Contains(lower, "127.0.0.1") ||
		strings.Contains(lower, "[::1]")
}
