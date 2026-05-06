package notifications

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// WebhookChannelConfig is the per-channel JSON payload stored in
// notification_channels.config when kind == "webhook".
type WebhookChannelConfig struct {
	URL    string            `json:"url"`
	Method string            `json:"method,omitempty"` // default POST
	Header map[string]string `json:"header,omitempty"`
}

// WebhookChannel implements Channel via HTTP POST with a Rioku-canonical
// JSON envelope. Distinct from the api-management webhook fan-out in
// dispatcher.go: this path posts notification messages, not state-change
// events, and uses no HMAC signing (channels are operator-managed).
type WebhookChannel struct {
	Config WebhookChannelConfig
	Client *http.Client
}

func NewWebhookChannel(configJSON string, client *http.Client) (*WebhookChannel, error) {
	var cfg WebhookChannelConfig
	if strings.TrimSpace(configJSON) == "" {
		return nil, ErrorPermanent(errors.New("webhook channel: empty config"))
	}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, ErrorPermanent(fmt.Errorf("webhook channel: parse config: %w", err))
	}
	if cfg.URL == "" {
		return nil, ErrorPermanent(errors.New("webhook channel: url is required"))
	}
	if cfg.Method == "" {
		cfg.Method = http.MethodPost
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &WebhookChannel{Config: cfg, Client: client}, nil
}

func (c *WebhookChannel) Kind() string { return "webhook" }

func (c *WebhookChannel) Send(ctx context.Context, msg Message) error {
	envelope := map[string]any{
		"v":         "v1",
		"kind":      msg.Kind,
		"subject":   msg.Subject,
		"body":      msg.Body,
		"severity":  msg.Severity,
		"metadata":  msg.Metadata,
		"timestamp": time.Now().UTC().Format(time.RFC3339Nano),
	}
	body, err := json.Marshal(envelope)
	if err != nil {
		return ErrorPermanent(fmt.Errorf("webhook marshal: %w", err))
	}
	req, err := http.NewRequestWithContext(ctx, c.Config.Method, c.Config.URL, bytes.NewReader(body))
	if err != nil {
		return ErrorPermanent(fmt.Errorf("webhook build request: %w", err))
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "rioku-notifications/1")
	for k, v := range c.Config.Header {
		req.Header.Set(k, v)
	}
	resp, err := c.Client.Do(req)
	if err != nil {
		return fmt.Errorf("webhook send: %w", err)
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); _ = resp.Body.Close() }()
	if resp.StatusCode/100 == 2 {
		return nil
	}
	if resp.StatusCode/100 == 4 && resp.StatusCode != http.StatusRequestTimeout && resp.StatusCode != http.StatusTooManyRequests {
		return ErrorPermanent(fmt.Errorf("webhook upstream %d", resp.StatusCode))
	}
	return fmt.Errorf("webhook upstream %d", resp.StatusCode)
}

// SlackChannel is a thin wrapper around the slack incoming-webhook
// endpoint shape. We marshal the message into slack's `text` field and
// send a POST. This is intentionally minimal — block-kit support can
// land in a follow-up.
type SlackChannel struct {
	WebhookURL string
	Client     *http.Client
}

type slackChannelConfig struct {
	WebhookURL string `json:"webhook_url"`
	Channel    string `json:"channel,omitempty"`
}

func NewSlackChannel(configJSON string, client *http.Client) (*SlackChannel, error) {
	var cfg slackChannelConfig
	if strings.TrimSpace(configJSON) == "" {
		return nil, ErrorPermanent(errors.New("slack channel: empty config"))
	}
	if err := json.Unmarshal([]byte(configJSON), &cfg); err != nil {
		return nil, ErrorPermanent(fmt.Errorf("slack channel: parse config: %w", err))
	}
	if cfg.WebhookURL == "" {
		return nil, ErrorPermanent(errors.New("slack channel: webhook_url is required"))
	}
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	return &SlackChannel{WebhookURL: cfg.WebhookURL, Client: client}, nil
}

func (c *SlackChannel) Kind() string { return "slack" }

func (c *SlackChannel) Send(ctx context.Context, msg Message) error {
	payload := map[string]any{
		"text": fmt.Sprintf("*%s*\n%s", msg.Subject, msg.Body),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ErrorPermanent(fmt.Errorf("slack marshal: %w", err))
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.WebhookURL, bytes.NewReader(body))
	if err != nil {
		return ErrorPermanent(fmt.Errorf("slack build request: %w", err))
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Client.Do(req)
	if err != nil {
		return fmt.Errorf("slack send: %w", err)
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); _ = resp.Body.Close() }()
	if resp.StatusCode/100 == 2 {
		return nil
	}
	if resp.StatusCode/100 == 4 {
		return ErrorPermanent(fmt.Errorf("slack upstream %d", resp.StatusCode))
	}
	return fmt.Errorf("slack upstream %d", resp.StatusCode)
}
