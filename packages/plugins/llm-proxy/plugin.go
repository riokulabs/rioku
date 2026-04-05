// Package llmproxy implements the LLM proxy/router traffic plugin.
// Routes requests to OpenAI, Anthropic, Ollama, and other providers.
// Supports model routing by cost, provider fallback, A/B routing,
// and per-key model restrictions. Exposes OpenAI-compatible endpoint.
package llmproxy
