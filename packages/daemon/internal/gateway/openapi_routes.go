package gateway

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"net/http"
)

//go:embed api.full.json
var openAPISpec []byte

var openAPIETag = func() string {
	sum := sha256.Sum256(openAPISpec)
	return `"` + hex.EncodeToString(sum[:8]) + `"`
}()

// RegisterOpenAPIRoute registers GET /api/v1/openapi.json on the given mux.
// The handler embeds the merged OpenAPI spec at compile time and serves it
// with ETag/If-None-Match caching (304 on hit, 200 with body on miss).
func RegisterOpenAPIRoute(mux *http.ServeMux) {
	mux.Handle("GET /api/v1/openapi.json", http.HandlerFunc(handleOpenAPI))
}

func handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	if r.Header.Get("If-None-Match") == openAPIETag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("ETag", openAPIETag)
	w.Header().Set("Cache-Control", "public, max-age=300")
	_, _ = w.Write(openAPISpec)
}
