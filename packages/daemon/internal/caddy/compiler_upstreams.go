package caddy

import (
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// buildTrustedProxiesBlock converts a TrustedProxiesConfig into the Caddy
// trusted_proxies value for a server block. Returns nil when there is nothing
// to configure.
//
// Static-only (no dynamic entries): emits the standard
//
//	{"source": "static", "ranges": [...]}
//
// Static + dynamic: emits the static block plus, for each dynamic entry, a
// separate named-module block. Caddy 2.x supports plug-in IP-source modules
// for "cloudflare" etc. For the "static" URL-refresh strategy we emit a
// placeholder block with the URL/refresh so that a future IP-source module can
// consume it. Limitations are documented with inline comments.
//
// NOTE: Caddy's server-level `trusted_proxies` key accepts a single IP-source
// module object (not an array). When dynamic entries are present we emit the
// first one; if both static CIDRs and dynamic strategies are configured we
// prefer the dynamic entry and add the static ranges to its block where
// possible. This is a best-effort mapping — operators with complex mixed
// configurations should validate the emitted Caddy JSON.
func buildTrustedProxiesBlock(cfg *TrustedProxiesConfig) any {
	if cfg == nil {
		return nil
	}
	hasStatic := len(cfg.Ranges) > 0
	hasDynamic := len(cfg.Dynamic) > 0

	if !hasStatic && !hasDynamic {
		return nil
	}

	// Static-only: use the simple "static" source module.
	if !hasDynamic {
		return map[string]any{
			"source": "static",
			"ranges": cfg.Ranges,
		}
	}

	// Dynamic present: emit the first dynamic strategy as the primary source.
	// Caddy's trusted_proxies accepts a single IP-source module object.
	first := cfg.Dynamic[0]
	const defaultRefreshSec = 3600
	refresh := first.RefreshSeconds
	if refresh <= 0 {
		refresh = defaultRefreshSec
	}

	switch first.Strategy {
	case "cloudflare":
		// Compiles to Caddy's cloudflare IP-source module. Static ranges are
		// not forwarded to this module (Cloudflare manages its own list).
		// Install github.com/caddy-dns/cloudflare or equivalent module.
		block := map[string]any{
			"source":  "cloudflare",
			"refresh": fmt.Sprintf("%ds", refresh),
		}
		return block

	default:
		// "static" URL-refresh strategy (or unknown). Emit a static block with
		// the known CIDRs. Caddy does not have a built-in URL-refresh source;
		// the URL and refresh are stored for operator reference and future
		// module support.
		ranges := append([]string{}, cfg.Ranges...)
		block := map[string]any{
			"source": "static",
			"ranges": ranges,
			// Informational fields — consumed by future dynamic IP-source modules.
			"_strategy_url":     first.URL,
			"_strategy_refresh": fmt.Sprintf("%ds", refresh),
		}
		return block
	}
}

// buildDynamicUpstreams converts a single dynamic Upstream (SrvLookup or
// ALookup) into a Caddy `dynamic_upstreams` block. The refresh duration is
// converted from seconds to nanoseconds (Go time.Duration).
func buildDynamicUpstreams(u *riokuv1.Upstream) (map[string]any, error) {
	const defaultRefreshNs = 60 * 1_000_000_000 // 60s in nanoseconds

	switch src := u.GetSource().(type) {
	case *riokuv1.Upstream_SrvLookup:
		srv := src.SrvLookup
		refresh := int64(srv.GetRefreshSeconds()) * 1_000_000_000
		if refresh <= 0 {
			refresh = defaultRefreshNs
		}
		block := map[string]any{
			"source":  "srv",
			"service": srv.GetService(),
			"refresh": refresh,
		}
		if p := srv.GetProto(); p != "" {
			block["proto"] = p
		}
		return block, nil

	case *riokuv1.Upstream_ALookup:
		al := src.ALookup
		refresh := int64(al.GetRefreshSeconds()) * 1_000_000_000
		if refresh <= 0 {
			refresh = defaultRefreshNs
		}
		return map[string]any{
			"source":  "a",
			"name":    al.GetName(),
			"port":    fmt.Sprintf("%d", al.GetPort()),
			"refresh": refresh,
		}, nil

	default:
		return nil, fmt.Errorf("upstream %q has no dynamic source set", u.GetId())
	}
}

// buildPassiveHealthCheck returns the Caddy `health_checks.passive`
// block for the supplied proto, or nil if passive checking is disabled
// or has no meaningful thresholds set. A passive block with all-zero
// thresholds would be a no-op in Caddy but pollutes the config; we
// suppress it here to keep the compiled JSON clean.
func buildPassiveHealthCheck(phc *riokuv1.PassiveHealthCheck) map[string]any {
	if phc == nil || !phc.GetEnabled() {
		return nil
	}
	out := map[string]any{}
	if v := phc.GetFailDurationSeconds(); v > 0 {
		out["fail_duration"] = fmt.Sprintf("%ds", v)
	}
	if v := phc.GetMaxFails(); v > 0 {
		out["max_fails"] = v
	}
	if statuses := phc.GetUnhealthyStatus(); len(statuses) > 0 {
		out["unhealthy_status"] = statuses
	}
	if v := phc.GetUnhealthyLatencyMs(); v > 0 {
		out["unhealthy_latency"] = fmt.Sprintf("%dms", v)
	}
	if v := phc.GetUnhealthyRequestCount(); v > 0 {
		out["unhealthy_request_count"] = v
	}
	// Suppress an empty block — see comment above.
	if len(out) == 0 {
		return nil
	}
	return out
}
