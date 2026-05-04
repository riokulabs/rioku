package registry

import "fmt"

// Cost is the calculator interface called from the AI gateway's
// post-request path (Sprint 5 Phase 1d, #166).
//
// Inputs are the model id + the token counts reported by the
// provider's `usage` block (per D10's reconcile-with-provider
// strategy). The function returns the dollar amount as a float64
// — high enough precision for typical AI request sizes; the
// spend log + rollups store the same value.
//
// CalculateRequestCost handles the common case (no prompt
// caching). CalculateRequestCostWithCache adds the cache-creation
// + cache-read costs that Anthropic + a few OpenAI models
// support.

// CalculateRequestCost returns the USD cost of a single AI
// request for the given model. The model is fetched from r;
// when it isn't registered the function returns 0 + an error so
// callers can decide whether to reject the request or charge $0.
//
// inputTokens / outputTokens come from the upstream's reported
// usage — NOT from the pre-call estimate. Per D10 the spend log
// records the reconciled values.
func (r *Registry) CalculateRequestCost(modelID string, inputTokens, outputTokens int) (float64, error) {
	m, err := r.Get(modelID)
	if err != nil {
		return 0, err
	}
	return calc(m, inputTokens, outputTokens), nil
}

// CalculateRequestCostWithCache adds prompt-caching token
// accounting. cacheCreationTokens are tokens written into the
// cache (typically billed at a premium). cacheReadTokens are
// tokens served from the cache (typically billed at a
// significant discount). Both fall back to the standard input
// rate when the model doesn't surface a cache-specific price.
func (r *Registry) CalculateRequestCostWithCache(
	modelID string,
	inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens int,
) (float64, error) {
	m, err := r.Get(modelID)
	if err != nil {
		return 0, err
	}

	cost := calc(m, inputTokens, outputTokens)
	cost += float64(cacheCreationTokens) * deref(m.CacheCreationInputTokenCost, deref(m.InputCostPerToken, 0))
	cost += float64(cacheReadTokens) * deref(m.CacheReadInputTokenCost, deref(m.InputCostPerToken, 0))
	return cost, nil
}

func calc(m *Model, inputTokens, outputTokens int) float64 {
	in := deref(m.InputCostPerToken, 0)
	out := deref(m.OutputCostPerToken, 0)
	return float64(inputTokens)*in + float64(outputTokens)*out
}

// FormatCost renders a cost value as a fixed-precision string
// suitable for the `x-rioku-response-cost` header (per D7's
// architecture diagram). Six decimal places — enough resolution
// for the cheapest models without scientific notation.
func FormatCost(usd float64) string {
	return fmt.Sprintf("%.6f", usd)
}

func deref(p *float64, dflt float64) float64 {
	if p == nil {
		return dflt
	}
	return *p
}
