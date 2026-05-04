package oasvalidator

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/routers"
	"github.com/getkin/kin-openapi/routers/gorillamux"
	"go.uber.org/zap"
)

// specLoader fetches and parses an OpenAPI spec from either a URL or
// an inline literal. The same loader instance is reused across
// refreshes; the parsed spec is held by the caller (Validator) and
// swapped atomically.
type specLoader struct {
	url    string
	inline string
	client *http.Client
	logger *zap.Logger
}

func newSpecLoader(specURL, specInline string, logger *zap.Logger) *specLoader {
	return &specLoader{
		url:    specURL,
		inline: specInline,
		client: &http.Client{
			// Refresh fetches must be bounded — a stuck origin must
			// not stall the refresh goroutine indefinitely. 30s is
			// generous for spec downloads; misbehaving origins are
			// the operator's problem to fix.
			Timeout: 30 * time.Second,
		},
		logger: logger,
	}
}

// Load fetches + parses the spec once. Caller is responsible for
// installing the resulting *openapi3.T into the live router. Validate()
// is invoked on the document so structural errors (broken $refs etc.)
// are caught at load time rather than at first request.
func (l *specLoader) Load(ctx context.Context) (*openapi3.T, error) {
	if l.url == "" && l.inline == "" {
		return nil, errors.New("specLoader: neither url nor inline configured")
	}

	loader := openapi3.NewLoader()
	loader.Context = ctx
	// External refs are off by default — the spec is a single
	// document fetched from a known location, $refs to other URLs
	// would silently expand the trust surface.
	loader.IsExternalRefsAllowed = false

	if l.inline != "" {
		doc, err := loader.LoadFromData([]byte(l.inline))
		if err != nil {
			return nil, fmt.Errorf("parse inline spec: %w", err)
		}
		if err := doc.Validate(ctx); err != nil {
			return nil, fmt.Errorf("validate inline spec: %w", err)
		}
		return doc, nil
	}

	data, err := l.fetchURL(ctx)
	if err != nil {
		return nil, err
	}
	// LoadFromDataWithPath lets relative $refs resolve against the
	// fetch URL, even though IsExternalRefsAllowed is false (refs
	// inside the same document still resolve).
	parsed, err := url.Parse(l.url)
	if err != nil {
		return nil, fmt.Errorf("parse oas_url %q: %w", l.url, err)
	}
	doc, err := loader.LoadFromDataWithPath(data, parsed)
	if err != nil {
		return nil, fmt.Errorf("parse spec from %s: %w", l.url, err)
	}
	if err := doc.Validate(ctx); err != nil {
		return nil, fmt.Errorf("validate spec from %s: %w", l.url, err)
	}
	return doc, nil
}

// fetchURL retrieves the raw spec bytes from the configured URL. The
// caller's context governs cancellation (Provision-time fetches use
// the Caddy provision context; refresh fetches use a derived timeout
// context).
func (l *specLoader) fetchURL(ctx context.Context) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, l.url, nil)
	if err != nil {
		return nil, fmt.Errorf("build request for %s: %w", l.url, err)
	}
	// Accept both YAML and JSON — kin-openapi sniffs the format.
	req.Header.Set("Accept", "application/json, application/yaml, text/yaml, text/plain;q=0.5, */*;q=0.1")

	resp, err := l.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch spec from %s: %w", l.url, err)
	}
	defer func() {
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch spec from %s: http %d", l.url, resp.StatusCode)
	}

	// Hard cap on spec size — 16 MiB is well above any reasonable
	// OAS document and protects against a malicious origin trying
	// to exhaust memory.
	const maxSpecBytes = 16 << 20
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxSpecBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read spec body: %w", err)
	}
	if len(data) > maxSpecBytes {
		return nil, fmt.Errorf("spec from %s exceeds %d bytes", l.url, maxSpecBytes)
	}
	return data, nil
}

// buildRouter constructs the gorillamux-backed router for the parsed
// spec. The router is the object that maps inbound requests to OAS
// operations — it's rebuilt on every refresh.
func buildRouter(doc *openapi3.T) (routers.Router, error) {
	r, err := gorillamux.NewRouter(doc)
	if err != nil {
		return nil, fmt.Errorf("build gorillamux router: %w", err)
	}
	return r, nil
}

// refreshLoop runs in a goroutine while the validator is active and
// the operator configured a positive RefreshIntervalSeconds with a
// URL-based spec. It re-fetches the spec on the configured cadence
// and atomically swaps the router on success. Failures keep the
// previous spec live and emit a structured warning.
func (v *Validator) refreshLoop() {
	interval := time.Duration(v.RefreshIntervalSeconds) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-v.stopRefresh:
			return
		case <-ticker.C:
			v.refreshOnce()
		}
	}
}

// refreshOnce fetches the spec and swaps the router on success. On
// failure, the previously-loaded router stays in place — refresh is
// best-effort. Each refresh runs under its own bounded context so a
// hanging origin can't block subsequent ticks.
func (v *Validator) refreshOnce() {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	doc, err := v.loader.Load(ctx)
	if err != nil {
		if v.logger != nil {
			v.logger.Warn("rioku_oas_validator: spec refresh failed",
				zap.String("url", v.OASURL),
				zap.Error(err),
			)
		}
		return
	}
	if err := v.installRouter(doc); err != nil {
		if v.logger != nil {
			v.logger.Warn("rioku_oas_validator: spec refresh built but router install failed",
				zap.String("url", v.OASURL),
				zap.Error(err),
			)
		}
		return
	}
	if v.logger != nil {
		v.logger.Debug("rioku_oas_validator: spec refreshed",
			zap.String("url", v.OASURL),
		)
	}
}
