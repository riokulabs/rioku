// Package tokens implements the daemon-side token-count
// approximation for the AI gateway (D10, #166 Phase 1d).
//
// v1 ships a 4-chars-per-token heuristic — the rough-but-honest
// approximation tiktoken's BPE tables produce in practice for
// English-dominant chat completion bodies. The error vs the
// upstream's reported `usage` block is typically under 10% on
// canonical prompts; reconciliation happens on the response path
// (the spend log records the upstream-reported numbers when
// available, the estimate when not).
//
// v2 will bundle exact tokenizers for known model families
// (cl100k_base for OpenAI, Anthropic's distinct tokenizer, Gemini)
// per D10. The estimator interface is structured so v2 swap-in
// only changes registration; callers stay unchanged.
package tokens

import (
	"strings"
	"unicode/utf8"
)

// Estimator returns the approximate token count for a given input
// + model. The model id lets v2 dispatch to the right exact
// tokenizer; v1 ignores it and returns the heuristic.
type Estimator interface {
	EstimateText(text, modelID string) int
}

// Heuristic is the v1 4-chars-per-token estimator.
type Heuristic struct{}

// NewHeuristic returns the default v1 estimator.
func NewHeuristic() Heuristic { return Heuristic{} }

// EstimateText returns ceil(len_runes / 4). Using rune count over
// byte count avoids over-estimating on multi-byte UTF-8 (e.g.
// CJK, emoji); the BPE tokenisers don't split a multi-byte
// codepoint into 4 separate tokens, so byte-count is biased
// high.
func (Heuristic) EstimateText(text, _ string) int {
	if text == "" {
		return 0
	}
	runes := utf8.RuneCountInString(text)
	if runes == 0 {
		return 0
	}
	// ceil(runes/4)
	return (runes + 3) / 4
}

// EstimateMessages estimates the input-token count for an OpenAI-
// shape chat-completion `messages` array. Each message contributes
// its content text; per OpenAI's accounting we add a small overhead
// per message (4 tokens) and a fixed reply prime (3 tokens). This
// matches tiktoken's `num_tokens_from_messages` formula closely
// enough for v1.
func EstimateMessages(messages []ChatMessage, modelID string) int {
	if len(messages) == 0 {
		return 0
	}
	est := NewHeuristic()
	total := 3 // assistant priming
	for _, m := range messages {
		total += 4 // per-message envelope overhead
		total += est.EstimateText(m.Role, modelID)
		total += est.EstimateText(m.Content, modelID)
		if m.Name != "" {
			total += 1 // name override
			total += est.EstimateText(m.Name, modelID)
		}
	}
	return total
}

// ChatMessage is the minimal shape we read from the inbound
// request body for token estimation. We intentionally do NOT model
// content parts (vision blocks, tool calls) here — those are out
// of scope for the v1 heuristic and would otherwise lock the
// estimator into OpenAI's specific schema.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
	Name    string `json:"name,omitempty"`
}

// EstimateOutputFromBytes is the streaming fallback when the
// upstream did not surface a usage block. Text chunks delivered
// over SSE typically carry ~1 token per ~4 bytes for ASCII; we
// reuse the same heuristic over the accumulated stream length.
func EstimateOutputFromBytes(streamedBytes int) int {
	if streamedBytes <= 0 {
		return 0
	}
	return (streamedBytes + 3) / 4
}

// SplitSSEEventBodies pulls the `data:` payloads out of an
// SSE chunk, dropping the framing. Used by the gateway's stream
// inspector when it tries to count output tokens chunk-by-chunk.
//
// The function is intentionally tolerant: it accepts both `\n`
// and `\r\n` line endings and silently skips comments
// (lines starting with `:`).
func SplitSSEEventBodies(chunk string) []string {
	chunk = strings.ReplaceAll(chunk, "\r\n", "\n")
	var out []string
	for _, line := range strings.Split(chunk, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, ":") {
			continue
		}
		if strings.HasPrefix(line, "data:") {
			out = append(out, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	return out
}
