// Package wasm provides a WASM plugin runtime using wazero (pure Go, no CGo).
// It defines the Rioku plugin ABI — a set of host functions that WASM guest
// plugins can call to interact with HTTP requests and the daemon.
//
// Architecture: Rioku-native ABI inspired by http-wasm (Traefik v3's approach).
// Simple request/response middleware model. NOT proxy-wasm.
package wasm

import (
	"context"
	"fmt"
	"net/http"
	"sync"

	"github.com/tetratelabs/wazero/api"
)

// Action is the return value from the guest's handle_request export.
type Action uint32

const (
	// ActionContinue tells the host to continue to the next middleware.
	ActionContinue Action = 0
	// ActionRespond tells the host to short-circuit and send the response immediately.
	ActionRespond Action = 1
)

// RequestContext holds the HTTP request/response state for a single plugin invocation.
// Each concurrent request gets its own RequestContext.
type RequestContext struct {
	mu sync.Mutex

	// Request data (set by host before calling handle_request).
	Method  string
	Path    string
	Headers http.Header

	// Response data (set by guest via host functions).
	RespStatus  int
	RespHeaders http.Header
	RespBody    []byte

	// Plugin config (JSON bytes).
	PluginConfig []byte

	// Log output captured from the guest.
	LogMessages []string
}

// NewRequestContext creates a RequestContext from an HTTP request.
func NewRequestContext(r *http.Request, pluginConfig []byte) *RequestContext {
	return &RequestContext{
		Method:       r.Method,
		Path:         r.URL.Path,
		Headers:      r.Header.Clone(),
		RespStatus:   0,
		RespHeaders:  make(http.Header),
		PluginConfig: pluginConfig,
	}
}

// contextKey is used to attach the RequestContext to the wazero context.
type contextKey struct{}

// withRequestContext attaches a RequestContext to the context.
func withRequestContext(ctx context.Context, rc *RequestContext) context.Context {
	return context.WithValue(ctx, contextKey{}, rc)
}

// getRequestContext retrieves the RequestContext from the context.
func getRequestContext(ctx context.Context) *RequestContext {
	rc, _ := ctx.Value(contextKey{}).(*RequestContext)
	return rc
}

// ---------------------------------------------------------------------------
// Host function implementations
// ---------------------------------------------------------------------------

// hostGetRequestHeader reads a request header by name.
// Guest calls: get_request_header(name_ptr, name_len) -> (val_ptr, val_len)
// Returns (0, 0) if header not found.
func hostGetRequestHeader(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		stack[0], stack[1] = 0, 0
		return
	}

	namePtr := uint32(stack[0])
	nameLen := uint32(stack[1])

	name, ok := readString(m, namePtr, nameLen)
	if !ok {
		stack[0], stack[1] = 0, 0
		return
	}

	rc.mu.Lock()
	val := rc.Headers.Get(name)
	rc.mu.Unlock()

	if val == "" {
		stack[0], stack[1] = 0, 0
		return
	}

	ptr, err := writeGuestString(ctx, m, val)
	if err != nil {
		stack[0], stack[1] = 0, 0
		return
	}
	stack[0] = uint64(ptr)
	stack[1] = uint64(len(val))
}

// hostSetRequestHeader sets or replaces a request header.
// Guest calls: set_request_header(name_ptr, name_len, val_ptr, val_len)
func hostSetRequestHeader(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		return
	}

	namePtr := uint32(stack[0])
	nameLen := uint32(stack[1])
	valPtr := uint32(stack[2])
	valLen := uint32(stack[3])

	name, ok := readString(m, namePtr, nameLen)
	if !ok {
		return
	}
	val, ok := readString(m, valPtr, valLen)
	if !ok {
		return
	}

	rc.mu.Lock()
	rc.Headers.Set(name, val)
	rc.mu.Unlock()
}

// hostGetRequestPath returns the request path.
// Guest calls: get_request_path() -> (ptr, len)
func hostGetRequestPath(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		stack[0], stack[1] = 0, 0
		return
	}

	ptr, err := writeGuestString(ctx, m, rc.Path)
	if err != nil {
		stack[0], stack[1] = 0, 0
		return
	}
	stack[0] = uint64(ptr)
	stack[1] = uint64(len(rc.Path))
}

// hostGetRequestMethod returns the HTTP method.
// Guest calls: get_request_method() -> (ptr, len)
func hostGetRequestMethod(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		stack[0], stack[1] = 0, 0
		return
	}

	ptr, err := writeGuestString(ctx, m, rc.Method)
	if err != nil {
		stack[0], stack[1] = 0, 0
		return
	}
	stack[0] = uint64(ptr)
	stack[1] = uint64(len(rc.Method))
}

// hostSetResponseStatus sets the response status code.
// Guest calls: set_response_status(code)
func hostSetResponseStatus(ctx context.Context, _ api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		return
	}
	rc.mu.Lock()
	rc.RespStatus = int(stack[0])
	rc.mu.Unlock()
}

// hostSetResponseHeader sets a response header.
// Guest calls: set_response_header(name_ptr, name_len, val_ptr, val_len)
func hostSetResponseHeader(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		return
	}

	namePtr := uint32(stack[0])
	nameLen := uint32(stack[1])
	valPtr := uint32(stack[2])
	valLen := uint32(stack[3])

	name, ok := readString(m, namePtr, nameLen)
	if !ok {
		return
	}
	val, ok := readString(m, valPtr, valLen)
	if !ok {
		return
	}

	rc.mu.Lock()
	rc.RespHeaders.Set(name, val)
	rc.mu.Unlock()
}

// hostSetResponseBody sets the response body.
// Guest calls: set_response_body(body_ptr, body_len)
func hostSetResponseBody(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		return
	}

	bodyPtr := uint32(stack[0])
	bodyLen := uint32(stack[1])

	data, ok := readBytes(m, bodyPtr, bodyLen)
	if !ok {
		return
	}

	rc.mu.Lock()
	rc.RespBody = data
	rc.mu.Unlock()
}

// hostLogInfo writes a log message.
// Guest calls: log_info(msg_ptr, msg_len)
func hostLogInfo(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		return
	}

	msgPtr := uint32(stack[0])
	msgLen := uint32(stack[1])

	msg, ok := readString(m, msgPtr, msgLen)
	if !ok {
		return
	}

	rc.mu.Lock()
	rc.LogMessages = append(rc.LogMessages, msg)
	rc.mu.Unlock()
}

// hostGetPluginConfig returns the plugin's JSON config.
// Guest calls: get_plugin_config() -> (ptr, len)
func hostGetPluginConfig(ctx context.Context, m api.Module, stack []uint64) {
	rc := getRequestContext(ctx)
	if rc == nil {
		stack[0], stack[1] = 0, 0
		return
	}

	if len(rc.PluginConfig) == 0 {
		stack[0], stack[1] = 0, 0
		return
	}

	ptr, err := writeGuestBytes(ctx, m, rc.PluginConfig)
	if err != nil {
		stack[0], stack[1] = 0, 0
		return
	}
	stack[0] = uint64(ptr)
	stack[1] = uint64(len(rc.PluginConfig))
}

// ---------------------------------------------------------------------------
// Memory helpers
// ---------------------------------------------------------------------------

// readString reads a string from guest memory.
func readString(m api.Module, ptr, length uint32) (string, bool) {
	data, ok := m.Memory().Read(ptr, length)
	if !ok {
		return "", false
	}
	return string(data), true
}

// readBytes reads bytes from guest memory (returns a copy).
func readBytes(m api.Module, ptr, length uint32) ([]byte, bool) {
	data, ok := m.Memory().Read(ptr, length)
	if !ok {
		return nil, false
	}
	cp := make([]byte, len(data))
	copy(cp, data)
	return cp, true
}

// writeGuestString allocates memory in the guest via its malloc export and writes the string.
func writeGuestString(ctx context.Context, m api.Module, s string) (uint32, error) {
	return writeGuestBytes(ctx, m, []byte(s))
}

// writeGuestBytes allocates memory in the guest via its malloc export and writes the bytes.
func writeGuestBytes(ctx context.Context, m api.Module, data []byte) (uint32, error) {
	malloc := m.ExportedFunction("malloc")
	if malloc == nil {
		return 0, fmt.Errorf("guest does not export malloc")
	}

	results, err := malloc.Call(ctx, uint64(len(data)))
	if err != nil {
		return 0, fmt.Errorf("malloc(%d): %w", len(data), err)
	}
	ptr := uint32(results[0])
	if !m.Memory().Write(ptr, data) {
		return 0, fmt.Errorf("write to guest memory at %d failed", ptr)
	}
	return ptr, nil
}
