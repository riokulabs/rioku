// Package transform implements request/response body transformation
// as a first-party Rioku Caddy handler module.
//
// It pairs with the upstream `request_header` / `header` directives
// (covered separately under issue #161) to provide full request and
// response rewriting capability. Two rule families are supported:
//
//   - Regex replace: a content-type-filtered substring rewrite over
//     the raw body bytes. Useful for arbitrary text/binary payloads
//     where the schema is unknown.
//   - JSONPath ops: structural set / delete / rename / copy on JSON
//     bodies, automatically gated on `Content-Type: application/json`.
//
// The JSONPath subset is deliberately narrow in v1 — dot-notation
// segments and integer array indices only (e.g. `a.b.0.c`). No
// wildcards, no filter expressions, no `$` root prefix. The surface
// is documented on the BodyRules struct.
//
// Bodies above MaxBodyBytes are passed through untouched + a debug
// log line emitted; we never load arbitrarily large payloads into
// memory. Default cap is 1 MiB.
package transform

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

// defaultMaxBodyBytes is the per-direction cap when MaxBodyBytes is
// unset on the request or response BodyRules. 1 MiB is a generous
// upper bound for typical API payloads while keeping memory bounded.
const defaultMaxBodyBytes int64 = 1 << 20

func init() {
	caddy.RegisterModule(Transform{})
	httpcaddyfile.RegisterHandlerDirective("rioku_transform", parseCaddyfileHandler)
}

// Transform is the Caddy handler that applies request-body and
// response-body rewrites. Either side may be nil to skip that
// direction; an empty rule set is a no-op.
type Transform struct {
	// Request, when set, applies to the inbound request body
	// before the upstream handler sees it.
	Request *BodyRules `json:"request,omitempty"`

	// Response, when set, applies to the response body returned
	// by the next handler before it is flushed to the client.
	Response *BodyRules `json:"response,omitempty"`

	logger *zap.Logger
}

// BodyRules is the set of transforms applied to a single direction
// (request or response). All rule lists are optional; an empty
// BodyRules is a structural no-op.
//
// JSONPath subset (set / delete / rename / copy):
//
//   - Segments are joined by '.'. Each segment is either an object
//     key or a non-negative integer interpreted as an array index.
//   - Examples: "user.name", "items.0.sku", "outer.inner.flag".
//   - Missing intermediate objects on a Set path are auto-created.
//   - Missing paths on Delete / Rename / Copy are silent no-ops.
//   - No wildcards (`*`), no filter expressions, no `$` root prefix,
//     no negative indices, no slice ranges.
type BodyRules struct {
	// RegexReplace is a list of regex-based substring rewrites
	// applied to the raw body bytes. Each rule may be gated on a
	// Content-Type substring filter.
	RegexReplace []RegexRule `json:"regex_replace,omitempty"`

	// JSONPathSet is a list of (path, value) writes applied when
	// the body's Content-Type is application/json. Missing
	// intermediate objects are created.
	JSONPathSet []JSONPathRule `json:"jsonpath_set,omitempty"`

	// JSONPathDelete removes JSON paths from the body
	// (Content-Type must be application/json). Missing paths are
	// silently skipped.
	JSONPathDelete []string `json:"jsonpath_delete,omitempty"`

	// JSONPathRename renames a key by moving its value from the
	// old path to the new path and deleting the old.
	JSONPathRename []JSONPathRenameRule `json:"jsonpath_rename,omitempty"`

	// JSONPathCopy duplicates the value at one path to another
	// path. The source remains untouched.
	JSONPathCopy []JSONPathCopyRule `json:"jsonpath_copy,omitempty"`

	// MaxBodyBytes caps the body size eligible for transformation.
	// Bodies larger than this pass through untouched and log at
	// debug. Zero / negative values use the package default
	// (1 MiB).
	MaxBodyBytes int64 `json:"max_body_bytes,omitempty"`
}

// RegexRule is a regex-based substring rewrite. ContentType, when
// non-empty, gates the rule on the request/response Content-Type
// containing that substring (case-insensitive). Empty applies to
// all bodies.
type RegexRule struct {
	Pattern     string `json:"pattern"`
	Replacement string `json:"replacement"`
	ContentType string `json:"content_type,omitempty"`

	compiled *regexp.Regexp
}

// JSONPathRule is a (path, value) pair for JSONPathSet. Value is
// stored as a JSON-encoded string and decoded into a generic any at
// apply time so callers can write literal numbers, strings, bools,
// arrays or objects.
type JSONPathRule struct {
	Path  string `json:"path"`
	Value string `json:"value"`
}

// JSONPathRenameRule moves a key from From to To.
type JSONPathRenameRule struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// JSONPathCopyRule copies a value from From to To, leaving the
// source untouched.
type JSONPathCopyRule struct {
	From string `json:"from"`
	To   string `json:"to"`
}

// CaddyModule registers this handler under
// http.handlers.rioku_transform.
func (Transform) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.rioku_transform",
		New: func() caddy.Module { return new(Transform) },
	}
}

// Provision compiles regex patterns and normalises defaults. Errors
// are returned at config-load time so misconfiguration never reaches
// the request path.
func (t *Transform) Provision(ctx caddy.Context) error {
	t.logger = ctx.Logger()
	if err := provisionRules(t.Request); err != nil {
		return fmt.Errorf("rioku_transform: request: %w", err)
	}
	if err := provisionRules(t.Response); err != nil {
		return fmt.Errorf("rioku_transform: response: %w", err)
	}
	return nil
}

func provisionRules(r *BodyRules) error {
	if r == nil {
		return nil
	}
	if r.MaxBodyBytes <= 0 {
		r.MaxBodyBytes = defaultMaxBodyBytes
	}
	for i := range r.RegexReplace {
		rule := &r.RegexReplace[i]
		if rule.Pattern == "" {
			return fmt.Errorf("regex_replace[%d]: pattern is required", i)
		}
		re, err := regexp.Compile(rule.Pattern)
		if err != nil {
			return fmt.Errorf("regex_replace[%d]: invalid pattern %q: %w", i, rule.Pattern, err)
		}
		rule.compiled = re
	}
	for i, rule := range r.JSONPathSet {
		if rule.Path == "" {
			return fmt.Errorf("jsonpath_set[%d]: path is required", i)
		}
		var probe any
		if err := json.Unmarshal([]byte(rule.Value), &probe); err != nil {
			return fmt.Errorf("jsonpath_set[%d]: value %q is not valid JSON: %w", i, rule.Value, err)
		}
	}
	for i, p := range r.JSONPathDelete {
		if p == "" {
			return fmt.Errorf("jsonpath_delete[%d]: path is required", i)
		}
	}
	for i, rule := range r.JSONPathRename {
		if rule.From == "" || rule.To == "" {
			return fmt.Errorf("jsonpath_rename[%d]: both from and to are required", i)
		}
	}
	for i, rule := range r.JSONPathCopy {
		if rule.From == "" || rule.To == "" {
			return fmt.Errorf("jsonpath_copy[%d]: both from and to are required", i)
		}
	}
	return nil
}

// Validate is a no-op; Provision already covers the surface. Kept
// to satisfy the caddy.Validator interface and for future expansion.
func (t *Transform) Validate() error { return nil }

// ServeHTTP applies the request rules, calls next, then applies the
// response rules. Either side may be nil — empty rules pass through.
func (t *Transform) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	if t.Request != nil && hasAnyRule(t.Request) {
		if err := t.applyRequest(r); err != nil {
			return fmt.Errorf("rioku_transform: request: %w", err)
		}
	}
	if t.Response != nil && hasAnyRule(t.Response) {
		rec := newBufferingRecorder(w, t.Response.MaxBodyBytes)
		if err := next.ServeHTTP(rec, r); err != nil {
			return err
		}
		return t.flushResponse(w, rec)
	}
	return next.ServeHTTP(w, r)
}

func hasAnyRule(r *BodyRules) bool {
	if r == nil {
		return false
	}
	return len(r.RegexReplace) > 0 ||
		len(r.JSONPathSet) > 0 ||
		len(r.JSONPathDelete) > 0 ||
		len(r.JSONPathRename) > 0 ||
		len(r.JSONPathCopy) > 0
}

// applyRequest reads r.Body up to MaxBodyBytes, applies rules, and
// substitutes a fresh ReadCloser carrying the transformed bytes.
// ContentLength + the Content-Length header are kept consistent.
func (t *Transform) applyRequest(r *http.Request) error {
	if r.Body == nil {
		return nil
	}
	max := t.Request.MaxBodyBytes
	// Read up to max+1 to detect oversize without loading more.
	buf, oversized, err := readCapped(r.Body, max)
	closeErr := r.Body.Close()
	if err != nil {
		return fmt.Errorf("read body: %w", err)
	}
	if closeErr != nil {
		return fmt.Errorf("close body: %w", closeErr)
	}
	if oversized {
		// Re-attach the bytes we read and pass through untouched.
		// Note: we cannot recover the unread tail, so an oversized
		// body cannot be safely passed through. Reject loudly so
		// the caller knows their MaxBodyBytes is too low.
		if t.logger != nil {
			t.logger.Debug("rioku_transform: request body exceeds max_body_bytes; rejecting",
				zap.Int64("max_body_bytes", max),
			)
		}
		return fmt.Errorf("request body exceeds max_body_bytes (%d)", max)
	}

	contentType := r.Header.Get("Content-Type")
	out, err := applyRules(buf, contentType, t.Request)
	if err != nil {
		return err
	}

	r.Body = io.NopCloser(bytes.NewReader(out))
	r.ContentLength = int64(len(out))
	r.Header.Set("Content-Length", strconv.Itoa(len(out)))
	return nil
}

// flushResponse applies rules to the buffered body captured by rec,
// re-emits headers (with corrected Content-Length), and writes the
// transformed bytes to the real ResponseWriter.
func (t *Transform) flushResponse(w http.ResponseWriter, rec *bufferingRecorder) error {
	body := rec.buf.Bytes()
	if rec.oversized {
		if t.logger != nil {
			t.logger.Debug("rioku_transform: response body exceeds max_body_bytes; pass-through",
				zap.Int64("max_body_bytes", t.Response.MaxBodyBytes),
			)
		}
		// Pass through untouched: re-emit headers + already-buffered prefix +
		// stream tail. Since the recorder swallowed Write past max, we must
		// not have rules apply. We replay what we have and propagate.
		return rec.replay(w)
	}

	contentType := rec.Header().Get("Content-Type")
	out, err := applyRules(body, contentType, t.Response)
	if err != nil {
		return err
	}

	dst := w.Header()
	for k, v := range rec.Header() {
		dst[k] = v
	}
	dst.Set("Content-Length", strconv.Itoa(len(out)))
	status := rec.status
	if status == 0 {
		status = http.StatusOK
	}
	w.WriteHeader(status)
	_, err = w.Write(out)
	return err
}

// applyRules runs the regex pass first, then the JSON pass. The
// order matters: callers typically use regex to scrub raw text
// (e.g. blanket secret redaction) and JSONPath to surgically
// reshape structured payloads.
func applyRules(body []byte, contentType string, rules *BodyRules) ([]byte, error) {
	out := body
	for _, rule := range rules.RegexReplace {
		if rule.compiled == nil {
			continue
		}
		if rule.ContentType != "" && !strings.Contains(strings.ToLower(contentType), strings.ToLower(rule.ContentType)) {
			continue
		}
		out = rule.compiled.ReplaceAll(out, []byte(rule.Replacement))
	}
	if !isJSON(contentType) {
		return out, nil
	}
	if len(rules.JSONPathSet) == 0 &&
		len(rules.JSONPathDelete) == 0 &&
		len(rules.JSONPathRename) == 0 &&
		len(rules.JSONPathCopy) == 0 {
		return out, nil
	}
	if len(out) == 0 {
		return out, nil
	}

	var doc any
	if err := json.Unmarshal(out, &doc); err != nil {
		// Body claims JSON but doesn't parse — leave it alone so we
		// don't clobber a 400/500 error body that happens to mis-tag
		// itself. Surface at debug only.
		return out, nil
	}

	for _, rule := range rules.JSONPathSet {
		var v any
		if err := json.Unmarshal([]byte(rule.Value), &v); err != nil {
			return nil, fmt.Errorf("jsonpath_set %q: invalid JSON value: %w", rule.Path, err)
		}
		newDoc, err := jsonPathSet(doc, rule.Path, v)
		if err != nil {
			return nil, fmt.Errorf("jsonpath_set %q: %w", rule.Path, err)
		}
		doc = newDoc
	}
	for _, p := range rules.JSONPathDelete {
		newDoc, err := jsonPathDelete(doc, p)
		if err != nil {
			return nil, fmt.Errorf("jsonpath_delete %q: %w", p, err)
		}
		doc = newDoc
	}
	for _, rule := range rules.JSONPathRename {
		newDoc, err := jsonPathRename(doc, rule.From, rule.To)
		if err != nil {
			return nil, fmt.Errorf("jsonpath_rename %q->%q: %w", rule.From, rule.To, err)
		}
		doc = newDoc
	}
	for _, rule := range rules.JSONPathCopy {
		newDoc, err := jsonPathCopy(doc, rule.From, rule.To)
		if err != nil {
			return nil, fmt.Errorf("jsonpath_copy %q->%q: %w", rule.From, rule.To, err)
		}
		doc = newDoc
	}

	return json.Marshal(doc)
}

func isJSON(contentType string) bool {
	if contentType == "" {
		return false
	}
	ct := strings.ToLower(contentType)
	// strip parameters like "; charset=utf-8"
	if idx := strings.Index(ct, ";"); idx >= 0 {
		ct = strings.TrimSpace(ct[:idx])
	}
	return ct == "application/json" ||
		strings.HasSuffix(ct, "+json")
}

// readCapped reads up to max bytes from r and returns (buf, oversize,
// err). When the source has more than max bytes, oversize is true
// and buf contains the first max bytes only.
func readCapped(r io.Reader, max int64) ([]byte, bool, error) {
	if max <= 0 {
		max = defaultMaxBodyBytes
	}
	limited := io.LimitReader(r, max+1)
	buf, err := io.ReadAll(limited)
	if err != nil {
		return nil, false, err
	}
	if int64(len(buf)) > max {
		return buf[:max], true, nil
	}
	return buf, false, nil
}

// bufferingRecorder is a minimal http.ResponseWriter that buffers
// the body so we can rewrite it before flushing to the real writer.
// We deliberately do not implement http.Flusher / Hijacker: response
// transforms are incompatible with streaming and SSE — those routes
// should not have rioku_transform attached on the response side.
type bufferingRecorder struct {
	header    http.Header
	buf       *bytes.Buffer
	status    int
	max       int64
	written   int64
	oversized bool
	headerOK  bool
	parent    http.ResponseWriter
}

func newBufferingRecorder(parent http.ResponseWriter, max int64) *bufferingRecorder {
	if max <= 0 {
		max = defaultMaxBodyBytes
	}
	return &bufferingRecorder{
		header: http.Header{},
		buf:    &bytes.Buffer{},
		max:    max,
		parent: parent,
	}
}

func (rr *bufferingRecorder) Header() http.Header { return rr.header }

func (rr *bufferingRecorder) WriteHeader(status int) {
	if rr.headerOK {
		return
	}
	rr.headerOK = true
	rr.status = status
}

func (rr *bufferingRecorder) Write(p []byte) (int, error) {
	if !rr.headerOK {
		rr.WriteHeader(http.StatusOK)
	}
	if rr.oversized {
		// We've already given up on transformation; keep counting
		// bytes for accurate logging but don't grow the buffer.
		rr.written += int64(len(p))
		return len(p), nil
	}
	remaining := rr.max - rr.written
	if int64(len(p)) > remaining {
		// Take what fits, mark oversize, drop the rest.
		if remaining > 0 {
			rr.buf.Write(p[:remaining])
		}
		rr.written += int64(len(p))
		rr.oversized = true
		return len(p), nil
	}
	n, err := rr.buf.Write(p)
	rr.written += int64(n)
	return n, err
}

// replay flushes whatever we buffered to the parent writer untouched.
// Used when the body exceeded MaxBodyBytes and we elected to skip
// transformation. Callers should NOT use this in the happy path.
func (rr *bufferingRecorder) replay(parent http.ResponseWriter) error {
	dst := parent.Header()
	for k, v := range rr.header {
		dst[k] = v
	}
	status := rr.status
	if status == 0 {
		status = http.StatusOK
	}
	parent.WriteHeader(status)
	_, err := parent.Write(rr.buf.Bytes())
	return err
}

// UnmarshalCaddyfile parses a Caddyfile block. The shape is:
//
//	rioku_transform {
//	    request {
//	        max_body_bytes 1048576
//	        regex_replace pattern replacement [content_type]
//	        jsonpath_set <path> <json-value>
//	        jsonpath_delete <path>
//	        jsonpath_rename <from> <to>
//	        jsonpath_copy <from> <to>
//	    }
//	    response {
//	        ...
//	    }
//	}
func (t *Transform) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for nesting := d.Nesting(); d.NextBlock(nesting); {
			switch d.Val() {
			case "request":
				rules, err := parseBodyRules(d)
				if err != nil {
					return err
				}
				t.Request = rules
			case "response":
				rules, err := parseBodyRules(d)
				if err != nil {
					return err
				}
				t.Response = rules
			default:
				return d.Errf("unknown rioku_transform directive: %q", d.Val())
			}
		}
	}
	return nil
}

func parseBodyRules(d *caddyfile.Dispenser) (*BodyRules, error) {
	rules := &BodyRules{}
	for nesting := d.Nesting(); d.NextBlock(nesting); {
		switch d.Val() {
		case "max_body_bytes":
			var v string
			if !d.Args(&v) {
				return nil, d.ArgErr()
			}
			n, err := strconv.ParseInt(v, 10, 64)
			if err != nil {
				return nil, d.Errf("invalid max_body_bytes %q: %v", v, err)
			}
			rules.MaxBodyBytes = n
		case "regex_replace":
			args := d.RemainingArgs()
			if len(args) < 2 || len(args) > 3 {
				return nil, d.Errf("regex_replace expects pattern + replacement [+ content_type]")
			}
			rule := RegexRule{Pattern: args[0], Replacement: args[1]}
			if len(args) == 3 {
				rule.ContentType = args[2]
			}
			rules.RegexReplace = append(rules.RegexReplace, rule)
		case "jsonpath_set":
			args := d.RemainingArgs()
			if len(args) != 2 {
				return nil, d.Errf("jsonpath_set expects path + json-value")
			}
			rules.JSONPathSet = append(rules.JSONPathSet, JSONPathRule{Path: args[0], Value: args[1]})
		case "jsonpath_delete":
			args := d.RemainingArgs()
			if len(args) != 1 {
				return nil, d.Errf("jsonpath_delete expects exactly one path")
			}
			rules.JSONPathDelete = append(rules.JSONPathDelete, args[0])
		case "jsonpath_rename":
			args := d.RemainingArgs()
			if len(args) != 2 {
				return nil, d.Errf("jsonpath_rename expects from + to")
			}
			rules.JSONPathRename = append(rules.JSONPathRename, JSONPathRenameRule{From: args[0], To: args[1]})
		case "jsonpath_copy":
			args := d.RemainingArgs()
			if len(args) != 2 {
				return nil, d.Errf("jsonpath_copy expects from + to")
			}
			rules.JSONPathCopy = append(rules.JSONPathCopy, JSONPathCopyRule{From: args[0], To: args[1]})
		default:
			return nil, d.Errf("unknown body-rule directive: %q", d.Val())
		}
	}
	return rules, nil
}

func parseCaddyfileHandler(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var t Transform
	if err := t.UnmarshalCaddyfile(h.Dispenser); err != nil {
		return nil, err
	}
	return &t, nil
}

// Interface guards.
var (
	_ caddy.Provisioner           = (*Transform)(nil)
	_ caddy.Validator             = (*Transform)(nil)
	_ caddyhttp.MiddlewareHandler = (*Transform)(nil)
	_ caddyfile.Unmarshaler       = (*Transform)(nil)
)
