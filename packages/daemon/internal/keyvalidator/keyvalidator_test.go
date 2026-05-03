package keyvalidator_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/keyvalidator"
	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func openDB(t *testing.T) store.Driver {
	t.Helper()
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(context.Background(), store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Migrate(context.Background(), store.MigrateUp); err != nil {
		t.Fatal(err)
	}
	return d
}

func hashKey(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// invokeValidator drives the handler in-process via httptest.
func invokeValidator(t *testing.T, srv *keyvalidator.Server, body string) *httptest.ResponseRecorder {
	t.Helper()
	// Reuse the package's POST handler by going through a direct
	// in-process http call against an httptest mux. The Server
	// uses a private mux; we drive it via an exported helper if
	// available, otherwise via a real listener.
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatalf("Listen: %v", err)
	}
	go func() {
		_ = srv.Serve()
	}()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	req, err := http.NewRequest(http.MethodPost, "http://"+srv.Addr()+"/validate-key", strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("client.Do: %v", err)
	}
	defer resp.Body.Close()
	rec := httptest.NewRecorder()
	rec.Code = resp.StatusCode
	for k, v := range resp.Header {
		rec.Header()[k] = v
	}
	buf := &bytes.Buffer{}
	if _, err := buf.ReadFrom(resp.Body); err != nil {
		t.Fatal(err)
	}
	rec.Body = buf
	return rec
}

func decodeResp(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("json.Unmarshal(%q): %v", rec.Body.String(), err)
	}
	return out
}

func TestValidator_ValidStandaloneKey(t *testing.T) {
	d := openDB(t)
	ctx := store.WithTenantID(context.Background(), "tenant_default")

	rawKey := "sk-live-" + uuid.NewString()
	hash := hashKey(rawKey)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	if _, err := tx.CreateAPIKey(ctx, "live", hash, []string{"keys:demo"}, nil, ""); err != nil {
		t.Fatal(err)
	}
	_ = tx.Commit()

	srv := keyvalidator.New(d, slog.Default())
	body, _ := json.Marshal(map[string]string{"key_hash": hash})
	rec := invokeValidator(t, srv, string(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body)
	}
	got := decodeResp(t, rec)
	if got["valid"] != true {
		t.Fatalf("valid = %v, want true; full: %v", got["valid"], got)
	}
	if scopes, ok := got["scopes"].([]any); !ok || len(scopes) != 1 {
		t.Errorf("scopes = %v, want one entry", got["scopes"])
	}
}

func TestValidator_MissingKeyReturnsReasonMissing(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	body, _ := json.Marshal(map[string]string{"key_hash": hashKey("never-issued")})
	rec := invokeValidator(t, srv, string(body))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}
	got := decodeResp(t, rec)
	if got["valid"] != false {
		t.Fatalf("valid = %v, want false", got["valid"])
	}
	if got["reason"] != "missing" {
		t.Errorf("reason = %v, want missing", got["reason"])
	}
}

func TestValidator_RevokedKey(t *testing.T) {
	d := openDB(t)
	ctx := store.WithTenantID(context.Background(), "tenant_default")

	rawKey := "sk-revoked-" + uuid.NewString()
	hash := hashKey(rawKey)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	keyID, _ := tx.CreateAPIKey(ctx, "x", hash, []string{}, nil, "")
	_ = tx.RevokeAPIKey(ctx, keyID)
	_ = tx.Commit()

	srv := keyvalidator.New(d, slog.Default())
	body, _ := json.Marshal(map[string]string{"key_hash": hash})
	rec := invokeValidator(t, srv, string(body))

	got := decodeResp(t, rec)
	if got["valid"] != false || got["reason"] != "revoked" {
		t.Fatalf("revoked path failed: %v", got)
	}
}

func TestValidator_MalformedRequestRejected(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	rec := invokeValidator(t, srv, `{`) // not valid JSON

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", rec.Code)
	}
}

func TestValidator_GETRejected(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	go func() { _ = srv.Serve() }()
	t.Cleanup(func() { _ = srv.Shutdown(context.Background()) })

	resp, err := http.Get("http://" + srv.Addr() + "/validate-key")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusMethodNotAllowed {
		t.Fatalf("status = %d, want 405", resp.StatusCode)
	}
}

func TestValidator_EmptyKeyHashReturnsMissing(t *testing.T) {
	d := openDB(t)
	srv := keyvalidator.New(d, slog.Default())
	rec := invokeValidator(t, srv, `{"key_hash": ""}`)

	got := decodeResp(t, rec)
	if got["valid"] != false || got["reason"] != "missing" {
		t.Fatalf("empty-hash path failed: %v", got)
	}
}
