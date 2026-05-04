package caddy

import (
	"fmt"
)

// buildTLSApp returns the `apps.tls` block for on-demand TLS provisioning
// when c.onDemandTLS is enabled, or nil to omit the block entirely.
//
// The compiled block instructs Caddy to call AskURL during the TLS
// handshake for any unknown SNI; the rioku tlsask service answers
// 200/403 based on whether the host is allow-listed by a configured,
// enabled route. This is the security gate from issue #66 — without
// the ask URL, on-demand TLS would let an attacker trigger ACME
// issuance for any domain pointed at the gateway.
func (c *Compiler) buildTLSApp() map[string]any {
	if !c.onDemandTLS.Enabled {
		return nil
	}
	if c.onDemandTLS.AskURL == "" {
		// Misconfigured: enabled without an ask URL. Refuse to emit
		// the block — silently allowing on-demand TLS without the
		// gate would let an attacker drive ACME issuance for any
		// host. The daemon should never reach this state because
		// SetOnDemandTLS is invoked with both fields together.
		return nil
	}

	onDemand := map[string]any{
		"ask": c.onDemandTLS.AskURL,
	}
	if c.onDemandTLS.IntervalSeconds > 0 && c.onDemandTLS.Burst > 0 {
		onDemand["rate_limit"] = map[string]any{
			"interval": fmt.Sprintf("%ds", c.onDemandTLS.IntervalSeconds),
			"burst":    c.onDemandTLS.Burst,
		}
	}

	return map[string]any{
		"automation": map[string]any{
			"policies": []map[string]any{
				{
					"on_demand": true,
				},
			},
			"on_demand": onDemand,
		},
	}
}
