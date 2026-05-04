package transform

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"go.uber.org/zap"
)

// nextHandler returns a caddyhttp.Handler that captures the request
// it receives and writes the configured response.
type capturedRequest struct {
	body        []byte
	contentType string
	contentLen  int64
	hdrLen      string
}

func captureNext(captured *capturedRequest, respStatus int, respCT, respBody string) caddyhttp.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) error {
		if r.Body != nil {
			b, err := io.ReadAll(r.Body)
			if err != nil {
				return err
			}
			captured.body = b
		}
		captured.contentType = r.Header.Get("Content-Type")
		captured.contentLen = r.ContentLength
		captured.hdrLen = r.Header.Get("Content-Length")
		if respCT != "" {
			w.Header().Set("Content-Type", respCT)
		}
		if respBody != "" {
			w.Header().Set("Content-Length", strconv.Itoa(len(respBody)))
		}
		if respStatus == 0 {
			respStatus = http.StatusOK
		}
		w.WriteHeader(respStatus)
		if respBody != "" {
			if _, err := io.WriteString(w, respBody); err != nil {
				return err
			}
		}
		return nil
	}
}

func mustProvision(t *testing.T, tr *Transform) {
	t.Helper()
	tr.logger = zap.NewNop()
	if err := provisionRules(tr.Request); err != nil {
		t.Fatalf("provision request: %v", err)
	}
	if err := provisionRules(tr.Response); err != nil {
		t.Fatalf("provision response: %v", err)
	}
}

func TestServeHTTP_EmptyRulesPassThrough(t *testing.T) {
	tr := &Transform{}
	mustProvision(t, tr)

	captured := &capturedRequest{}
	next := captureNext(captured, http.StatusOK, "text/plain", "ok")
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("hello"))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = 5

	w := httptest.NewRecorder()
	if err := tr.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if string(captured.body) != "hello" {
		t.Fatalf("upstream body = %q, want hello", captured.body)
	}
	if w.Body.String() != "ok" {
		t.Fatalf("client body = %q, want ok", w.Body.String())
	}
}

func TestServeHTTP_RegexReplaceRequestBody(t *testing.T) {
	tr := &Transform{Request: &BodyRules{
		RegexReplace: []RegexRule{
			{Pattern: `secret-\d+`, Replacement: "REDACTED"},
		},
	}}
	mustProvision(t, tr)

	captured := &capturedRequest{}
	next := captureNext(captured, http.StatusOK, "", "")

	body := "before secret-42 after secret-99"
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = int64(len(body))

	if err := tr.ServeHTTP(httptest.NewRecorder(), req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	want := "before REDACTED after REDACTED"
	if string(captured.body) != want {
		t.Fatalf("got %q want %q", captured.body, want)
	}
	if captured.contentLen != int64(len(want)) {
		t.Fatalf("ContentLength = %d, want %d", captured.contentLen, len(want))
	}
	if captured.hdrLen != strconv.Itoa(len(want)) {
		t.Fatalf("Content-Length header = %q, want %d", captured.hdrLen, len(want))
	}
}

func TestServeHTTP_RegexContentTypeFilterSkipsNonMatching(t *testing.T) {
	tr := &Transform{Request: &BodyRules{
		RegexReplace: []RegexRule{
			// Only apply on JSON bodies.
			{Pattern: `secret`, Replacement: "REDACTED", ContentType: "application/json"},
		},
	}}
	mustProvision(t, tr)

	captured := &capturedRequest{}
	next := captureNext(captured, http.StatusOK, "", "")

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("a secret value"))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = int64(len("a secret value"))

	if err := tr.ServeHTTP(httptest.NewRecorder(), req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if string(captured.body) != "a secret value" {
		t.Fatalf("body should be untouched: got %q", captured.body)
	}
}

func TestServeHTTP_JSONPathOpsOnRequest(t *testing.T) {
	tr := &Transform{Request: &BodyRules{
		JSONPathSet: []JSONPathRule{
			{Path: "added", Value: `"yes"`},
			{Path: "user.role", Value: `"admin"`},
		},
		JSONPathDelete: []string{"secret"},
		JSONPathRename: []JSONPathRenameRule{{From: "old", To: "new"}},
		JSONPathCopy:   []JSONPathCopyRule{{From: "user.name", To: "display"}},
	}}
	mustProvision(t, tr)

	captured := &capturedRequest{}
	next := captureNext(captured, http.StatusOK, "", "")

	body := `{"user":{"name":"alice"},"secret":"hush","old":"value"}`
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.ContentLength = int64(len(body))

	if err := tr.ServeHTTP(httptest.NewRecorder(), req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	var got map[string]any
	if err := json.Unmarshal(captured.body, &got); err != nil {
		t.Fatalf("decode upstream body: %v (raw=%s)", err, captured.body)
	}
	if got["added"] != "yes" {
		t.Errorf("set top-level: got %v", got["added"])
	}
	user, _ := got["user"].(map[string]any)
	if user["role"] != "admin" {
		t.Errorf("set nested: got %v", user)
	}
	if _, present := got["secret"]; present {
		t.Errorf("delete: secret still present")
	}
	if _, present := got["old"]; present {
		t.Errorf("rename: old key still present")
	}
	if got["new"] != "value" {
		t.Errorf("rename: new key = %v", got["new"])
	}
	if got["display"] != "alice" {
		t.Errorf("copy: display = %v", got["display"])
	}
	// Verify Content-Length is the new length, not the old.
	if captured.contentLen != int64(len(captured.body)) {
		t.Errorf("ContentLength = %d, want %d", captured.contentLen, len(captured.body))
	}
}

func TestServeHTTP_JSONPathSkippedOnNonJSON(t *testing.T) {
	tr := &Transform{Request: &BodyRules{
		JSONPathSet: []JSONPathRule{{Path: "added", Value: `true`}},
	}}
	mustProvision(t, tr)

	captured := &capturedRequest{}
	next := captureNext(captured, http.StatusOK, "", "")

	body := "not json at all"
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = int64(len(body))

	if err := tr.ServeHTTP(httptest.NewRecorder(), req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if string(captured.body) != body {
		t.Fatalf("body should be untouched on text/plain: got %q", captured.body)
	}
}

func TestServeHTTP_ResponseBodyTransformed(t *testing.T) {
	tr := &Transform{Response: &BodyRules{
		RegexReplace: []RegexRule{
			{Pattern: `world`, Replacement: "Rioku"},
		},
		JSONPathSet: []JSONPathRule{
			{Path: "stamped", Value: `true`},
		},
	}}
	mustProvision(t, tr)

	respBody := `{"hello":"world"}`
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Length", strconv.Itoa(len(respBody)))
		w.WriteHeader(http.StatusOK)
		_, err := io.WriteString(w, respBody)
		return err
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	if err := tr.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	got := w.Body.Bytes()
	var doc map[string]any
	if err := json.Unmarshal(got, &doc); err != nil {
		t.Fatalf("decode resp: %v (raw=%s)", err, got)
	}
	if doc["hello"] != "Rioku" {
		t.Errorf("regex on response: got %v", doc["hello"])
	}
	if doc["stamped"] != true {
		t.Errorf("jsonpath on response: got %v", doc["stamped"])
	}
	// Content-Length must reflect the new size.
	hdrLen := w.Header().Get("Content-Length")
	if hdrLen != strconv.Itoa(len(got)) {
		t.Errorf("Content-Length header = %q, want %d", hdrLen, len(got))
	}
}

func TestServeHTTP_ResponseStatusPreserved(t *testing.T) {
	tr := &Transform{Response: &BodyRules{
		RegexReplace: []RegexRule{{Pattern: `x`, Replacement: "X"}},
	}}
	mustProvision(t, tr)

	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusTeapot)
		_, err := io.WriteString(w, "xyzzy")
		return err
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	if err := tr.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}
	if w.Code != http.StatusTeapot {
		t.Fatalf("status = %d, want 418", w.Code)
	}
	if w.Body.String() != "Xyzzy" {
		t.Fatalf("body = %q, want Xyzzy", w.Body.String())
	}
}

func TestServeHTTP_LargeRequestBodyExceedsMaxBytes(t *testing.T) {
	tr := &Transform{Request: &BodyRules{
		RegexReplace: []RegexRule{{Pattern: `x`, Replacement: "y"}},
		MaxBodyBytes: 64,
	}}
	mustProvision(t, tr)

	called := false
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		called = true
		return nil
	})

	body := bytes.Repeat([]byte("x"), 1024)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(body))
	req.Header.Set("Content-Type", "text/plain")
	req.ContentLength = int64(len(body))

	err := tr.ServeHTTP(httptest.NewRecorder(), req, next)
	if err == nil {
		t.Fatal("expected error for oversized request body")
	}
	if !strings.Contains(err.Error(), "max_body_bytes") {
		t.Fatalf("error = %v, want max_body_bytes mention", err)
	}
	if called {
		t.Fatal("next handler should not be called when request body is rejected")
	}
}

func TestServeHTTP_LargeResponseBodyPassThrough(t *testing.T) {
	tr := &Transform{Response: &BodyRules{
		RegexReplace: []RegexRule{{Pattern: `x`, Replacement: "y"}},
		MaxBodyBytes: 64,
	}}
	mustProvision(t, tr)

	respBody := strings.Repeat("x", 1024)
	next := caddyhttp.HandlerFunc(func(w http.ResponseWriter, r *http.Request) error {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, err := io.WriteString(w, respBody)
		return err
	})

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	if err := tr.ServeHTTP(w, req, next); err != nil {
		t.Fatalf("ServeHTTP: %v", err)
	}

	// Oversize bodies are not transformed; the buffered prefix
	// should be replayed untouched (no x->y rewrite, length is the
	// captured prefix not the full upstream body).
	got := w.Body.String()
	if strings.ContainsRune(got, 'y') {
		t.Errorf("response body was transformed despite oversize: got %q", got[:min(40, len(got))])
	}
	if len(got) > 64 {
		t.Errorf("response body length = %d, want <= 64 (prefix only)", len(got))
	}
}

func TestApplyRules_RegexThenJSONPath(t *testing.T) {
	rules := &BodyRules{
		RegexReplace: []RegexRule{{Pattern: `secret`, Replacement: "REDACTED"}},
		JSONPathSet:  []JSONPathRule{{Path: "stamped", Value: `1`}},
	}
	if err := provisionRules(rules); err != nil {
		t.Fatal(err)
	}

	in := []byte(`{"k":"secret"}`)
	out, err := applyRules(in, "application/json", rules)
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	if err := json.Unmarshal(out, &doc); err != nil {
		t.Fatalf("decode: %v (raw=%s)", err, out)
	}
	if doc["k"] != "REDACTED" {
		t.Errorf("regex didn't run before json: got %v", doc["k"])
	}
	if v, _ := doc["stamped"].(float64); v != 1 {
		t.Errorf("jsonpath set didn't run: got %v", doc["stamped"])
	}
}

func TestApplyRules_BadJSONLeftAlone(t *testing.T) {
	rules := &BodyRules{
		JSONPathSet: []JSONPathRule{{Path: "x", Value: `1`}},
	}
	if err := provisionRules(rules); err != nil {
		t.Fatal(err)
	}
	in := []byte(`{"broken": tru`)
	out, err := applyRules(in, "application/json", rules)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, in) {
		t.Errorf("malformed JSON should be left alone, got %q", out)
	}
}

func TestIsJSON(t *testing.T) {
	cases := []struct {
		ct   string
		want bool
	}{
		{"application/json", true},
		{"application/json; charset=utf-8", true},
		{"APPLICATION/JSON", true},
		{"application/vnd.api+json", true},
		{"text/plain", false},
		{"", false},
	}
	for _, tc := range cases {
		if got := isJSON(tc.ct); got != tc.want {
			t.Errorf("isJSON(%q) = %v, want %v", tc.ct, got, tc.want)
		}
	}
}

func TestProvisionRules_RegexCompileError(t *testing.T) {
	rules := &BodyRules{RegexReplace: []RegexRule{{Pattern: `[`, Replacement: "x"}}}
	if err := provisionRules(rules); err == nil {
		t.Fatal("expected error for invalid regex")
	}
}

func TestProvisionRules_BadJSONValue(t *testing.T) {
	rules := &BodyRules{JSONPathSet: []JSONPathRule{{Path: "a", Value: "not json"}}}
	if err := provisionRules(rules); err == nil {
		t.Fatal("expected error for non-JSON value")
	}
}

func TestUnmarshalCaddyfile_FullBlock(t *testing.T) {
	src := `rioku_transform {
		request {
			max_body_bytes 2048
			regex_replace foo bar application/json
			jsonpath_set added "yes"
			jsonpath_delete secret
			jsonpath_rename old new
			jsonpath_copy src dst
		}
		response {
			regex_replace world Rioku
		}
	}`

	d := caddyfile.NewTestDispenser(src)
	var tr Transform
	if err := tr.UnmarshalCaddyfile(d); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if tr.Request == nil || tr.Response == nil {
		t.Fatal("both directions should be set")
	}
	if tr.Request.MaxBodyBytes != 2048 {
		t.Errorf("max_body_bytes = %d", tr.Request.MaxBodyBytes)
	}
	if len(tr.Request.RegexReplace) != 1 || tr.Request.RegexReplace[0].ContentType != "application/json" {
		t.Errorf("regex_replace not parsed: %+v", tr.Request.RegexReplace)
	}
	if len(tr.Request.JSONPathSet) != 1 || tr.Request.JSONPathSet[0].Path != "added" {
		t.Errorf("jsonpath_set not parsed: %+v", tr.Request.JSONPathSet)
	}
	if len(tr.Request.JSONPathDelete) != 1 || tr.Request.JSONPathDelete[0] != "secret" {
		t.Errorf("jsonpath_delete not parsed: %+v", tr.Request.JSONPathDelete)
	}
	if len(tr.Request.JSONPathRename) != 1 {
		t.Errorf("jsonpath_rename not parsed: %+v", tr.Request.JSONPathRename)
	}
	if len(tr.Request.JSONPathCopy) != 1 {
		t.Errorf("jsonpath_copy not parsed: %+v", tr.Request.JSONPathCopy)
	}
	if len(tr.Response.RegexReplace) != 1 {
		t.Errorf("response regex not parsed")
	}
}

func TestUnmarshalCaddyfile_RegexReplaceArgCount(t *testing.T) {
	src := `rioku_transform {
		request {
			regex_replace only-one
		}
	}`
	d := caddyfile.NewTestDispenser(src)
	var tr Transform
	if err := tr.UnmarshalCaddyfile(d); err == nil {
		t.Fatal("expected error for too-few regex_replace args")
	}
}
