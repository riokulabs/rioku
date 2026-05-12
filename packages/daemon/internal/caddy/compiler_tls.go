package caddy

import (
	"fmt"
)

// buildTLSApp returns the `apps.tls` block for on-demand TLS provisioning
// when c.onDemandTLS is enabled and/or for static wildcard cert loading
// when c.subdomainCert is set. Returns nil to omit the block entirely
// when neither feature is active.
//
// On-demand TLS: the compiled block instructs Caddy to call AskURL
// during the TLS handshake for any unknown SNI; the rioku tlsask
// service answers 200/403 based on whether the host is allow-listed by
// a configured, enabled route. This is the security gate from issue
// #66 — without the ask URL, on-demand TLS would let an attacker
// trigger ACME issuance for any domain pointed at the gateway.
//
// Subdomain cert: when SubdomainCertFile/KeyFile are set, the compiler
// emits an `apps.tls.certificates.load_files` entry so Caddy serves
// the supplied wildcard leaf for handshakes whose SNI matches it
// (e.g. `*.localhost` in the sandbox).
func (c *Compiler) buildTLSApp() map[string]any {
	hasOnDemand := c.onDemandTLS.Enabled && c.onDemandTLS.AskURL != ""
	hasSubdomainCert := c.subdomainCert.CertFile != "" && c.subdomainCert.KeyFile != ""

	if !hasOnDemand && !hasSubdomainCert {
		// On-demand misconfigured (Enabled without AskURL) is treated
		// as off here — silently allowing on-demand TLS without the
		// ask gate would let an attacker drive ACME issuance for any
		// host. The daemon should never reach that state because
		// SetOnDemandTLS is invoked with both fields together.
		return nil
	}

	tls := map[string]any{}

	if hasOnDemand {
		onDemand := map[string]any{
			"ask": c.onDemandTLS.AskURL,
		}
		if c.onDemandTLS.IntervalSeconds > 0 && c.onDemandTLS.Burst > 0 {
			onDemand["rate_limit"] = map[string]any{
				"interval": fmt.Sprintf("%ds", c.onDemandTLS.IntervalSeconds),
				"burst":    c.onDemandTLS.Burst,
			}
		}
		tls["automation"] = map[string]any{
			"policies": []map[string]any{
				{
					"on_demand": true,
				},
			},
			"on_demand": onDemand,
		}
	}

	if hasSubdomainCert {
		tls["certificates"] = map[string]any{
			"load_files": []map[string]any{
				{
					"certificate": c.subdomainCert.CertFile,
					"key":         c.subdomainCert.KeyFile,
				},
			},
		}
	}

	return tls
}
