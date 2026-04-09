package tracestore

import (
	"net"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// caddyLogLine returns a minimal Caddy structured JSON access log entry.
func caddyLogLine() []byte {
	return []byte(`{
		"level": "info",
		"ts": 1700000000.500000,
		"logger": "http.log.access.rioku",
		"msg": "handled request",
		"request": {
			"remote_ip": "127.0.0.1",
			"remote_port": "54321",
			"client_ip": "127.0.0.1",
			"proto": "HTTP/1.1",
			"method": "GET",
			"host": "example.com",
			"uri": "/api/users?page=1",
			"headers": {}
		},
		"bytes_read": 128,
		"user_id": "",
		"duration": 0.005123,
		"size": 1234,
		"status": 200,
		"resp_headers": {},
		"rioku_route_id": "route-abc",
		"rioku_service_id": "svc-xyz",
		"upstream_address": "10.0.0.1:8080"
	}`)
}

// TestIngester_ParseLogLine verifies that a Caddy JSON log line is parsed into
// a RequestTrace with all expected fields populated.
func TestIngester_ParseLogLine(t *testing.T) {
	trace, err := ParseLogLine(caddyLogLine())
	if err != nil {
		t.Fatalf("ParseLogLine error: %v", err)
	}

	// trace_id must be a non-empty UUID.
	if trace.TraceId == "" {
		t.Error("TraceId should not be empty")
	}

	// started_at must be derived from the ts field.
	// ts = 1700000000.5 → seconds=1700000000, nanos=500000000
	wantSec := int64(1700000000)
	if trace.StartedAt == nil {
		t.Fatal("StartedAt should not be nil")
	}
	if trace.StartedAt.Seconds != wantSec {
		t.Errorf("StartedAt.Seconds = %d, want %d", trace.StartedAt.Seconds, wantSec)
	}

	// duration_ms = duration * 1000 = 0.005123 * 1000 ≈ 5
	if trace.DurationMs != 5 {
		t.Errorf("DurationMs = %d, want 5", trace.DurationMs)
	}

	// method
	if trace.Method != "GET" {
		t.Errorf("Method = %q, want %q", trace.Method, "GET")
	}

	// path (uri)
	if trace.Path != "/api/users?page=1" {
		t.Errorf("Path = %q, want %q", trace.Path, "/api/users?page=1")
	}

	// host
	if trace.Host != "example.com" {
		t.Errorf("Host = %q, want %q", trace.Host, "example.com")
	}

	// status
	if trace.StatusCode != 200 {
		t.Errorf("StatusCode = %d, want 200", trace.StatusCode)
	}

	// bytes_sent (size)
	if trace.BytesSent != 1234 {
		t.Errorf("BytesSent = %d, want 1234", trace.BytesSent)
	}

	// bytes_recv (bytes_read)
	if trace.BytesRecv != 128 {
		t.Errorf("BytesRecv = %d, want 128", trace.BytesRecv)
	}

	// route_id
	if trace.RouteId != "route-abc" {
		t.Errorf("RouteId = %q, want %q", trace.RouteId, "route-abc")
	}

	// service_id
	if trace.ServiceId != "svc-xyz" {
		t.Errorf("ServiceId = %q, want %q", trace.ServiceId, "svc-xyz")
	}

	// upstream_addr
	if trace.UpstreamAddr != "10.0.0.1:8080" {
		t.Errorf("UpstreamAddr = %q, want %q", trace.UpstreamAddr, "10.0.0.1:8080")
	}
}

// TestIngester_SamplingRate verifies that ShouldSample passes approximately
// Rate fraction of traces for a given sampling rate.
func TestIngester_SamplingRate(t *testing.T) {
	cfg := SamplingConfig{
		Rate:         0.5,
		ErrorsAlways: false,
		AIAlways:     false,
	}

	const total = 1000
	passed := 0
	for i := 0; i < total; i++ {
		tr := makeTrace("t", time.Now())
		tr.StatusCode = 200
		if ShouldSample(tr, cfg) {
			passed++
		}
	}

	// With rate=0.5 and 1000 samples, expect 40–60%.
	lo, hi := 400, 600
	if passed < lo || passed > hi {
		t.Errorf("ShouldSample passed %d/%d (%.1f%%), expected %d–%d", passed, total, float64(passed)/float64(total)*100, lo, hi)
	}
}

// TestIngester_ErrorsAlwaysSampled verifies that error traces (status >= 500)
// are always sampled regardless of the rate.
func TestIngester_ErrorsAlwaysSampled(t *testing.T) {
	cfg := SamplingConfig{
		Rate:         0.1,
		ErrorsAlways: true,
	}

	const total = 100
	const errCount = 10

	errorsPassed := 0
	for i := 0; i < total; i++ {
		tr := makeTrace("t", time.Now())
		if i < errCount {
			tr.StatusCode = 500
		} else {
			tr.StatusCode = 200
		}
		if ShouldSample(tr, cfg) && tr.StatusCode == 500 {
			errorsPassed++
		}
	}

	if errorsPassed != errCount {
		t.Errorf("errors sampled = %d, want %d (all errors must pass)", errorsPassed, errCount)
	}
}

// TestIngester_UnixgramSocket starts an Ingester on a temp socket path, writes
// a JSON log line via a client unixgram connection, and verifies the trace
// appears in the ring buffer.
func TestIngester_UnixgramSocket(t *testing.T) {
	dir := t.TempDir()
	socketPath := filepath.Join(dir, "rioku-trace.sock")

	rb := NewRingBuffer(64)
	cfg := SamplingConfig{Rate: 1.0}
	ing := NewIngester(socketPath, rb, cfg)

	if err := ing.Start(t.Context()); err != nil {
		t.Fatalf("Start: %v", err)
	}
	t.Cleanup(func() { ing.Stop() })

	// Give the ingester goroutine a moment to start listening.
	time.Sleep(20 * time.Millisecond)

	// Verify socket file exists.
	if _, err := os.Stat(socketPath); err != nil {
		t.Fatalf("socket file not found: %v", err)
	}

	// Write a log line via a client unixgram connection.
	clientConn, err := net.Dial("unixgram", socketPath)
	if err != nil {
		t.Fatalf("Dial unixgram: %v", err)
	}
	defer clientConn.Close()

	line := caddyLogLine()
	if _, err := clientConn.Write(line); err != nil {
		t.Fatalf("Write: %v", err)
	}

	// Wait for the ingester to process the datagram.
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if rb.Len() > 0 {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}

	if rb.Len() == 0 {
		t.Fatal("ring buffer is empty after sending log line")
	}

	traces := rb.Snapshot(1)
	tr := traces[0]
	if tr.Method != "GET" {
		t.Errorf("Method = %q, want %q", tr.Method, "GET")
	}
	if tr.Path != "/api/users?page=1" {
		t.Errorf("Path = %q, want %q", tr.Path, "/api/users?page=1")
	}
}
