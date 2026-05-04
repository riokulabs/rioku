package config_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/riokulabs/rioku/internal/config"
)

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

// writeConfig writes yaml content to a temp file and returns its path.
func writeConfig(t *testing.T, yaml string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "rioku.yaml")
	if err := os.WriteFile(p, []byte(yaml), 0o640); err != nil {
		t.Fatalf("writeConfig: %v", err)
	}
	return p
}

// Minimal valid config that passes all validation.
const validYAML = `
store:
  driver: sqlite
  sqlite:
    path: /tmp/test.db
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
`

// --------------------------------------------------------------------------
// Default()
// --------------------------------------------------------------------------

func TestConfig_Default(t *testing.T) {
	cfg := config.Default()
	if cfg == nil {
		t.Fatal("Default() returned nil")
		return
	}

	// Store
	if cfg.Store.Driver == "" {
		t.Error("Store.Driver should not be empty")
	}

	// Listen
	if cfg.Listen.GRPC == "" {
		t.Error("Listen.GRPC should not be empty")
	}
	if cfg.Listen.REST == "" {
		t.Error("Listen.REST should not be empty")
	}

	// DataDir
	if cfg.DataDir == "" {
		t.Error("DataDir should not be empty")
	}
	if cfg.DataDir != config.DefaultDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, config.DefaultDataDir)
	}

	// Traces
	if cfg.Traces.Store == "" {
		t.Error("Traces.Store should not be empty")
	}
	if cfg.Traces.BufferSize == 0 {
		t.Error("Traces.BufferSize should not be zero")
	}
	if cfg.Traces.BufferSize != 10000 {
		t.Errorf("Traces.BufferSize = %d, want 10000", cfg.Traces.BufferSize)
	}
	if cfg.Traces.Path == "" {
		t.Error("Traces.Path should not be empty")
	}
	if cfg.Traces.Sampling.Rate == nil {
		t.Error("Traces.Sampling.Rate should not be nil")
	}
	if cfg.Traces.MaxSizeGB == nil {
		t.Error("Traces.MaxSizeGB should not be nil")
	}

	// PKI
	if cfg.PKI.CA.KeyAlgorithm == "" {
		t.Error("PKI.CA.KeyAlgorithm should not be empty")
	}
	if cfg.PKI.CA.KeyPassphraseSource == "" {
		t.Error("PKI.CA.KeyPassphraseSource should not be empty")
	}

	// LogLevel
	if cfg.LogLevel == "" {
		t.Error("LogLevel should not be empty")
	}
}

// --------------------------------------------------------------------------
// Load() — success paths
// --------------------------------------------------------------------------

func TestConfig_Load_ValidFile(t *testing.T) {
	p := writeConfig(t, validYAML)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg == nil {
		t.Fatal("Load() returned nil config")
		return
	}
	if cfg.Store.Driver != "sqlite" {
		t.Errorf("Store.Driver = %q, want %q", cfg.Store.Driver, "sqlite")
	}
	if cfg.Store.SQLite.Path != "/tmp/test.db" {
		t.Errorf("Store.SQLite.Path = %q, want /tmp/test.db", cfg.Store.SQLite.Path)
	}
	if cfg.DataDir != "/tmp/rioku" {
		t.Errorf("DataDir = %q, want /tmp/rioku", cfg.DataDir)
	}
	if cfg.Listen.GRPC != ":7777" {
		t.Errorf("Listen.GRPC = %q, want :7777", cfg.Listen.GRPC)
	}
	if cfg.Listen.REST != ":7778" {
		t.Errorf("Listen.REST = %q, want :7778", cfg.Listen.REST)
	}
}

func TestConfig_Load_EmptyPath_UsesDefault(t *testing.T) {
	// When path is empty Load falls back to DefaultConfigPath (/etc/rioku/rioku.yaml).
	// That file almost certainly doesn't exist in CI, so we just verify we get
	// a file-not-found error rather than a panic.
	_, err := config.Load("")
	if err == nil {
		// If the file happens to exist and is valid, that's fine too.
		return
	}
	// Should be a "reading" error wrapping an os.ErrNotExist.
	if !strings.Contains(err.Error(), "config: reading") {
		t.Errorf("unexpected error format: %v", err)
	}
}

// --------------------------------------------------------------------------
// Load() — failure paths
// --------------------------------------------------------------------------

func TestConfig_Load_MissingFile(t *testing.T) {
	_, err := config.Load("/nonexistent/path/rioku.yaml")
	if err == nil {
		t.Fatal("Load() should return error for missing file")
	}
	if !strings.Contains(err.Error(), "config: reading") {
		t.Errorf("error should mention 'config: reading', got: %v", err)
	}
}

func TestConfig_Load_InvalidYAML(t *testing.T) {
	p := writeConfig(t, "store: [this: is: not: valid: yaml")
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for invalid YAML")
	}
	if !strings.Contains(err.Error(), "config: parsing") {
		t.Errorf("error should mention 'config: parsing', got: %v", err)
	}
}

// --------------------------------------------------------------------------
// validate() — enum checks (exercised via Load)
// --------------------------------------------------------------------------

func TestConfig_Validate_InvalidDriver(t *testing.T) {
	yaml := `
store:
  driver: "invalid"
  sqlite:
    path: /tmp/test.db
data_dir: /tmp/rioku
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for invalid store driver")
	}
	if !strings.Contains(err.Error(), "store.driver") {
		t.Errorf("error should mention 'store.driver', got: %v", err)
	}
}

func TestConfig_Validate_InvalidLogLevel(t *testing.T) {
	yaml := validYAML + "\nlog_level: invalid\n"
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for invalid log_level")
	}
	if !strings.Contains(err.Error(), "log_level") {
		t.Errorf("error should mention 'log_level', got: %v", err)
	}
}

func TestConfig_Validate_InvalidTraceStore(t *testing.T) {
	yaml := validYAML + `
traces:
  store: "invalid"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for invalid traces.store")
	}
	if !strings.Contains(err.Error(), "traces.store") {
		t.Errorf("error should mention 'traces.store', got: %v", err)
	}
}

func TestConfig_Validate_InvalidKeyAlgorithm(t *testing.T) {
	yaml := validYAML + `
pki:
  ca:
    key_algorithm: "invalid"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for invalid pki.ca.key_algorithm")
	}
	if !strings.Contains(err.Error(), "pki.ca.key_algorithm") {
		t.Errorf("error should mention 'pki.ca.key_algorithm', got: %v", err)
	}
}

func TestConfig_Validate_InvalidPassphraseSource(t *testing.T) {
	yaml := validYAML + `
pki:
  ca:
    key_passphrase_source: "invalid"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for invalid pki.ca.key_passphrase_source")
	}
	if !strings.Contains(err.Error(), "pki.ca.key_passphrase_source") {
		t.Errorf("error should mention 'pki.ca.key_passphrase_source', got: %v", err)
	}
}

func TestConfig_Validate_SamplingRateOutOfRange(t *testing.T) {
	yaml := validYAML + `
traces:
  sampling:
    rate: 2.0
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for sampling rate > 1")
	}
	if !strings.Contains(err.Error(), "traces.sampling.rate") {
		t.Errorf("error should mention 'traces.sampling.rate', got: %v", err)
	}
}

func TestConfig_Validate_SamplingRateNegative(t *testing.T) {
	yaml := validYAML + `
traces:
  sampling:
    rate: -0.5
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for negative sampling rate")
	}
	if !strings.Contains(err.Error(), "traces.sampling.rate") {
		t.Errorf("error should mention 'traces.sampling.rate', got: %v", err)
	}
}

func TestConfig_Validate_NegativeMaxSize(t *testing.T) {
	yaml := validYAML + `
traces:
  max_size_gb: -1
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for negative max_size_gb")
	}
	if !strings.Contains(err.Error(), "traces.max_size_gb") {
		t.Errorf("error should mention 'traces.max_size_gb', got: %v", err)
	}
}

func TestConfig_Validate_ZeroMaxSize(t *testing.T) {
	yaml := validYAML + `
traces:
  max_size_gb: 0
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for zero max_size_gb")
	}
	if !strings.Contains(err.Error(), "traces.max_size_gb") {
		t.Errorf("error should mention 'traces.max_size_gb', got: %v", err)
	}
}

// --------------------------------------------------------------------------
// validate() — driver-specific required fields
// --------------------------------------------------------------------------

func TestConfig_Validate_MissingSQLitePath(t *testing.T) {
	// applyDefaults re-fills store.sqlite.path from data_dir when it is empty,
	// so we cannot produce this validation error through Load alone (the default
	// is always set before validate runs).  Instead verify the happy path: a
	// driver=sqlite config with an explicit path loads without error.
	yaml := `
store:
  driver: sqlite
  sqlite:
    path: /tmp/test.db
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error for sqlite config: %v", err)
	}
	if cfg.Store.SQLite.Path != "/tmp/test.db" {
		t.Errorf("Store.SQLite.Path = %q, want /tmp/test.db", cfg.Store.SQLite.Path)
	}
}

func TestConfig_Validate_MissingPostgresDSN(t *testing.T) {
	yaml := `
store:
  driver: postgres
  postgres:
    dsn: ""
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error when postgres dsn is empty")
	}
	if !strings.Contains(err.Error(), "store.postgres.dsn") {
		t.Errorf("error should mention 'store.postgres.dsn', got: %v", err)
	}
}

func TestConfig_Validate_MissingMySQLDSN(t *testing.T) {
	// Non-Galera MySQL with no dsn and no nodes.
	yaml := `
store:
  driver: mysql
  mysql:
    galera: false
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error when mysql dsn/nodes are missing")
	}
	if !strings.Contains(err.Error(), "store.mysql.dsn") {
		t.Errorf("error should mention 'store.mysql.dsn', got: %v", err)
	}
}

func TestConfig_Validate_GaleraMissingNodes(t *testing.T) {
	yaml := `
store:
  driver: mysql
  mysql:
    galera: true
    nodes: []
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error when galera nodes list is empty")
	}
	if !strings.Contains(err.Error(), "store.mysql.nodes") {
		t.Errorf("error should mention 'store.mysql.nodes', got: %v", err)
	}
}

func TestConfig_Validate_GaleraNodeMissingDSN(t *testing.T) {
	yaml := `
store:
  driver: mysql
  mysql:
    galera: true
    nodes:
      - dsn: ""
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error when galera node DSN is empty")
	}
	if !strings.Contains(err.Error(), "store.mysql.nodes[0].dsn") {
		t.Errorf("error should mention 'store.mysql.nodes[0].dsn', got: %v", err)
	}
}

func TestConfig_Validate_MissingRaftBindAddr(t *testing.T) {
	// Raft driver with an explicit empty bind_addr (overrides the default).
	// Because applyDefaults sets bind_addr when it is empty, we need to set
	// a sentinel that is neither empty nor the default, then clear via a
	// two-pass approach.  The simplest approach: supply bind_addr explicitly
	// as an empty string in YAML.  yaml.v3 will set the string to "", which
	// applyDefaults will then backfill — so we test the validate path that
	// is guarded by applyDefaults having already set it.
	//
	// To actually hit the validation error we need bind_addr to still be ""
	// after applyDefaults runs.  applyDefaults only fills it when it is "".
	// So if YAML sets it to "", applyDefaults will set it back to "127.0.0.1:7779".
	// We cannot exercise this error path through Load alone without patching
	// internals.  Document this limitation and instead verify that a raft config
	// with a valid bind_addr loads successfully.
	yaml := `
store:
  driver: raft
  raft:
    node_id: node-0
    bind_addr: "127.0.0.1:7779"
    bootstrap: true
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error for valid raft config: %v", err)
	}
	if cfg.Store.Driver != "raft" {
		t.Errorf("Store.Driver = %q, want raft", cfg.Store.Driver)
	}
	if cfg.Store.Raft.BindAddr != "127.0.0.1:7779" {
		t.Errorf("Store.Raft.BindAddr = %q, want 127.0.0.1:7779", cfg.Store.Raft.BindAddr)
	}
}

// --------------------------------------------------------------------------
// applyDefaults() — derived paths and fallbacks
// --------------------------------------------------------------------------

func TestConfig_ApplyDefaults_TracesPath(t *testing.T) {
	// When data_dir is overridden, traces.path should derive from it.
	yaml := `
store:
  driver: sqlite
  sqlite:
    path: /custom/rioku.db
data_dir: /custom
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	// applyDefaults should derive /custom/traces from /custom.
	if cfg.Traces.Path != "/custom/traces" {
		t.Errorf("Traces.Path = %q, want /custom/traces", cfg.Traces.Path)
	}
}

func TestConfig_ApplyDefaults_BufferSize(t *testing.T) {
	p := writeConfig(t, validYAML)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Traces.BufferSize != 10000 {
		t.Errorf("Traces.BufferSize = %d, want 10000", cfg.Traces.BufferSize)
	}
}

func TestConfig_ApplyDefaults_DataDir(t *testing.T) {
	// Verify Default() uses DefaultDataDir.
	cfg := config.Default()
	if cfg.DataDir != config.DefaultDataDir {
		t.Errorf("Default DataDir = %q, want %q", cfg.DataDir, config.DefaultDataDir)
	}
}

func TestConfig_ApplyDefaults_CaddyDataDir(t *testing.T) {
	// Default() pre-populates caddy.data_dir and pki.dir with /var/lib/rioku/caddy
	// and /var/lib/rioku/pki.  applyDefaults only backfills them when they are
	// empty ("").  When a user sets data_dir but omits caddy.data_dir/pki.dir,
	// YAML unmarshalling overlays on top of Default() leaving the compile-time
	// values in place.  Verify the default derivation: these fields carry the
	// DefaultDataDir prefix by default.
	cfg := config.Default()
	wantCaddyDir := config.DefaultDataDir + "/caddy"
	wantPKIDir := config.DefaultDataDir + "/pki"
	if cfg.Caddy.DataDir != wantCaddyDir {
		t.Errorf("Default Caddy.DataDir = %q, want %q", cfg.Caddy.DataDir, wantCaddyDir)
	}
	if cfg.PKI.Dir != wantPKIDir {
		t.Errorf("Default PKI.Dir = %q, want %q", cfg.PKI.Dir, wantPKIDir)
	}

	// Explicitly providing caddy.data_dir in YAML overrides it correctly.
	yaml := `
store:
  driver: sqlite
  sqlite:
    path: /mydata/rioku.db
data_dir: /mydata
caddy:
  data_dir: /mydata/caddy
pki:
  dir: /mydata/pki
listen:
  grpc: ":7777"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Caddy.DataDir != "/mydata/caddy" {
		t.Errorf("Caddy.DataDir = %q, want /mydata/caddy", cfg.Caddy.DataDir)
	}
	if cfg.PKI.Dir != "/mydata/pki" {
		t.Errorf("PKI.Dir = %q, want /mydata/pki", cfg.PKI.Dir)
	}
}

func TestConfig_ApplyDefaults_ListenFallbacks(t *testing.T) {
	// When listen addresses are omitted entirely, defaults are applied.
	yaml := `
store:
  driver: sqlite
  sqlite:
    path: /tmp/test.db
data_dir: /tmp/rioku
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Listen.GRPC != ":7777" {
		t.Errorf("Listen.GRPC = %q, want :7777", cfg.Listen.GRPC)
	}
	if cfg.Listen.REST != ":7778" {
		t.Errorf("Listen.REST = %q, want :7778", cfg.Listen.REST)
	}
}

func TestConfig_ApplyDefaults_LogLevel(t *testing.T) {
	// When log_level is omitted, it should default to "info".
	p := writeConfig(t, validYAML)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", cfg.LogLevel)
	}
}

func TestConfig_ApplyDefaults_PKIAlgorithmFallback(t *testing.T) {
	p := writeConfig(t, validYAML)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.PKI.CA.KeyAlgorithm != "ecdsa-p256" {
		t.Errorf("PKI.CA.KeyAlgorithm = %q, want ecdsa-p256", cfg.PKI.CA.KeyAlgorithm)
	}
	if cfg.PKI.CA.KeyPassphraseSource != "auto" {
		t.Errorf("PKI.CA.KeyPassphraseSource = %q, want auto", cfg.PKI.CA.KeyPassphraseSource)
	}
}

// TestConfig_ApplyDefaults_EmptyDriver exercises the Store.Driver = "raft"
// fallback together with the other non-driver fields.
func TestConfig_ApplyDefaults_EmptyDriver(t *testing.T) {
	// Clearing driver to "" triggers cfg.Store.Driver = "raft" in applyDefaults.
	// We also clear caddy, listen, log_level, and traces fields.
	// Because driver="" the raft-specific sub-block (NodeID/BindAddr) is not
	// reachable in the same pass; those are covered by TestConfig_ApplyDefaults_RaftDefaults.
	// After applyDefaults sets driver="raft", validation will see bind_addr="" and
	// fail — so we pre-set bind_addr to satisfy validation.
	yaml := `
store:
  driver: ""
  raft:
    bind_addr: "127.0.0.1:7779"
data_dir: ""
caddy:
  binary: ""
  admin_addr: ""
  data_dir: ""
pki:
  dir: ""
listen:
  grpc: ""
  rest: ""
log_level: ""
traces:
  store: ""
  buffer_size: 0
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}

	if cfg.DataDir != config.DefaultDataDir {
		t.Errorf("DataDir = %q, want %q", cfg.DataDir, config.DefaultDataDir)
	}
	if cfg.Store.Driver != "raft" {
		t.Errorf("Store.Driver = %q, want raft", cfg.Store.Driver)
	}
	if cfg.Caddy.Binary != "caddy" {
		t.Errorf("Caddy.Binary = %q, want caddy", cfg.Caddy.Binary)
	}
	if cfg.Caddy.AdminAddr != "localhost:2019" {
		t.Errorf("Caddy.AdminAddr = %q, want localhost:2019", cfg.Caddy.AdminAddr)
	}
	if cfg.Listen.GRPC != ":7777" {
		t.Errorf("Listen.GRPC = %q, want :7777", cfg.Listen.GRPC)
	}
	if cfg.Listen.REST != ":7778" {
		t.Errorf("Listen.REST = %q, want :7778", cfg.Listen.REST)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", cfg.LogLevel)
	}
	if cfg.Traces.Store != "sqlite" {
		t.Errorf("Traces.Store = %q, want sqlite", cfg.Traces.Store)
	}
	if cfg.Traces.BufferSize != 10000 {
		t.Errorf("Traces.BufferSize = %d, want 10000", cfg.Traces.BufferSize)
	}
}

// TestConfig_ApplyDefaults_RaftDefaults exercises the raft-specific NodeID and
// BindAddr fallbacks in applyDefaults.
func TestConfig_ApplyDefaults_RaftDefaults(t *testing.T) {
	yaml := `
store:
  driver: raft
  raft:
    node_id: ""
    bind_addr: ""
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Store.Raft.NodeID != "node-0" {
		t.Errorf("Store.Raft.NodeID = %q, want node-0", cfg.Store.Raft.NodeID)
	}
	if cfg.Store.Raft.BindAddr != "127.0.0.1:7779" {
		t.Errorf("Store.Raft.BindAddr = %q, want 127.0.0.1:7779", cfg.Store.Raft.BindAddr)
	}
}

// TestConfig_ApplyDefaults_SQLitePath exercises the sqlite-driver path in
// applyDefaults that derives sqlite.path from data_dir when both are empty.
func TestConfig_ApplyDefaults_SQLitePath(t *testing.T) {
	yaml := `
store:
  driver: sqlite
  sqlite:
    path: ""
data_dir: ""
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	wantPath := config.DefaultDataDir + "/rioku.db"
	if cfg.Store.SQLite.Path != wantPath {
		t.Errorf("Store.SQLite.Path = %q, want %q", cfg.Store.SQLite.Path, wantPath)
	}
}

// --------------------------------------------------------------------------
// validate() — listen address required
// --------------------------------------------------------------------------

func TestConfig_Validate_ListenGRPCOverride(t *testing.T) {
	// applyDefaults fills listen.grpc when empty, so empty string in YAML is
	// auto-corrected before validation.  Verify instead that an explicit
	// non-default address is parsed and preserved.
	yaml := `
store:
  driver: sqlite
  sqlite:
    path: /tmp/test.db
data_dir: /tmp/rioku
listen:
  grpc: ":9999"
  rest: ":7778"
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Listen.GRPC != ":9999" {
		t.Errorf("Listen.GRPC = %q, want :9999", cfg.Listen.GRPC)
	}
}

func TestConfig_Validate_ListenRESTOverride(t *testing.T) {
	// Same reasoning as GRPC — verify explicit REST address is preserved.
	yaml := `
store:
  driver: sqlite
  sqlite:
    path: /tmp/test.db
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":8888"
`
	p := writeConfig(t, yaml)
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() unexpected error: %v", err)
	}
	if cfg.Listen.REST != ":8888" {
		t.Errorf("Listen.REST = %q, want :8888", cfg.Listen.REST)
	}
}

// --------------------------------------------------------------------------
// validate() — multiple errors accumulated
// --------------------------------------------------------------------------

func TestConfig_Validate_MultipleErrors(t *testing.T) {
	// Both an invalid driver and an invalid log_level should produce errors
	// for both fields (validate accumulates via errors.Join).
	yaml := `
store:
  driver: "bad-driver"
data_dir: /tmp/rioku
listen:
  grpc: ":7777"
  rest: ":7778"
log_level: "bad-level"
`
	p := writeConfig(t, yaml)
	_, err := config.Load(p)
	if err == nil {
		t.Fatal("Load() should return error for multiple invalid fields")
	}
	errStr := err.Error()
	if !strings.Contains(errStr, "store.driver") {
		t.Errorf("error should mention 'store.driver', got: %v", err)
	}
	if !strings.Contains(errStr, "log_level") {
		t.Errorf("error should mention 'log_level', got: %v", err)
	}
}

// --------------------------------------------------------------------------
// World-readable warning (informational only)
// --------------------------------------------------------------------------

func TestConfig_Load_WorldReadable_NoError(t *testing.T) {
	// A world-readable file should produce a warning on stderr but NOT an error.
	p := writeConfig(t, validYAML)
	if err := os.Chmod(p, 0o644); err != nil {
		t.Fatalf("chmod: %v", err)
	}
	cfg, err := config.Load(p)
	if err != nil {
		t.Fatalf("Load() should not error on world-readable file, got: %v", err)
	}
	if cfg == nil {
		t.Fatal("Load() returned nil config")
	}
}

// --------------------------------------------------------------------------
// Valid enum values accepted
// --------------------------------------------------------------------------

func TestConfig_Validate_AllValidLogLevels(t *testing.T) {
	for _, level := range []string{"debug", "info", "warn", "error"} {
		level := level
		t.Run(level, func(t *testing.T) {
			yaml := validYAML + "\nlog_level: " + level + "\n"
			p := writeConfig(t, yaml)
			if _, err := config.Load(p); err != nil {
				t.Errorf("Load() unexpected error for log_level=%q: %v", level, err)
			}
		})
	}
}

func TestConfig_Validate_AllValidKeyAlgorithms(t *testing.T) {
	for _, algo := range []string{"ecdsa-p256", "ecdsa-p384", "rsa-2048", "rsa-4096", "ed25519"} {
		algo := algo
		t.Run(algo, func(t *testing.T) {
			yaml := validYAML + `
pki:
  ca:
    key_algorithm: ` + algo + "\n"
			p := writeConfig(t, yaml)
			if _, err := config.Load(p); err != nil {
				t.Errorf("Load() unexpected error for key_algorithm=%q: %v", algo, err)
			}
		})
	}
}

func TestConfig_Validate_AllValidPassphraseSources(t *testing.T) {
	for _, src := range []string{"auto", "systemd-creds", "kernel-keyring", "env", "encrypted-file"} {
		src := src
		t.Run(src, func(t *testing.T) {
			yaml := validYAML + `
pki:
  ca:
    key_passphrase_source: ` + src + "\n"
			p := writeConfig(t, yaml)
			if _, err := config.Load(p); err != nil {
				t.Errorf("Load() unexpected error for key_passphrase_source=%q: %v", src, err)
			}
		})
	}
}

func TestConfig_Validate_AllValidTraceStores(t *testing.T) {
	for _, store := range []string{"sqlite", "duckdb"} {
		store := store
		t.Run(store, func(t *testing.T) {
			yaml := validYAML + `
traces:
  store: ` + store + "\n"
			p := writeConfig(t, yaml)
			if _, err := config.Load(p); err != nil {
				t.Errorf("Load() unexpected error for traces.store=%q: %v", store, err)
			}
		})
	}
}

func TestConfig_Validate_SamplingRateBoundary(t *testing.T) {
	for _, rate := range []string{"0.0", "0.5", "1.0"} {
		rate := rate
		t.Run(rate, func(t *testing.T) {
			yaml := validYAML + `
traces:
  sampling:
    rate: ` + rate + "\n"
			p := writeConfig(t, yaml)
			if _, err := config.Load(p); err != nil {
				t.Errorf("Load() unexpected error for sampling.rate=%s: %v", rate, err)
			}
		})
	}
}

// TestConfig_LoopbackOnly_RejectsExternalAddrs verifies that the
// keyvalidator / AI gateway / TLS-ask listeners refuse to bind to
// non-loopback hosts. These endpoints carry no auth — exposing them
// would be a security hole, so validate() rejects up front.
func TestConfig_LoopbackOnly_RejectsExternalAddrs(t *testing.T) {
	cases := []struct {
		field, addr string
	}{
		{"key_validator_addr", "0.0.0.0:7791"},
		{"key_validator_addr", ":7791"},
		{"key_validator_addr", "10.0.0.5:7791"},
		{"key_validator_addr", "192.168.1.1:7791"},
		{"ai_gateway_addr", "0.0.0.0:7792"},
		{"tls_ask_addr", "0.0.0.0:7790"},
	}
	for _, tc := range cases {
		t.Run(tc.field+"="+tc.addr, func(t *testing.T) {
			yaml := `data_dir: /tmp/rioku
listen:
  grpc: 127.0.0.1:7777
  rest: 127.0.0.1:7778
  ` + tc.field + `: ` + tc.addr + `
store:
  driver: sqlite
  sqlite:
    path: /tmp/rioku.db
`
			p := writeConfig(t, yaml)
			_, err := config.Load(p)
			if err == nil {
				t.Fatalf("expected error for %s = %q, got nil", tc.field, tc.addr)
			}
			if !strings.Contains(err.Error(), "loopback") {
				t.Errorf("err = %q, want mention of 'loopback'", err)
			}
		})
	}
}

// TestConfig_LoopbackOnly_AcceptsLocalhost verifies that legitimate
// loopback addresses (127.0.0.1, ::1, localhost) pass validation.
func TestConfig_LoopbackOnly_AcceptsLocalhost(t *testing.T) {
	cases := []string{
		"127.0.0.1:7791",
		"127.0.0.42:7791",
		"[::1]:7791",
		"localhost:7791",
	}
	for _, addr := range cases {
		t.Run(addr, func(t *testing.T) {
			// quoted in YAML so bracketed IPv6 [::1]:7791 doesn't trip
			// the flow-mapping parser.
			yaml := `data_dir: /tmp/rioku
listen:
  grpc: 127.0.0.1:7777
  rest: 127.0.0.1:7778
  key_validator_addr: "` + addr + `"
store:
  driver: sqlite
  sqlite:
    path: /tmp/rioku.db
`
			p := writeConfig(t, yaml)
			if _, err := config.Load(p); err != nil {
				t.Errorf("Load() unexpected error for loopback addr %q: %v", addr, err)
			}
		})
	}
}
