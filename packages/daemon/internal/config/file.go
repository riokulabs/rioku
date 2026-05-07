// Package config implements the config engine that sits between the
// gRPC service layer and the store driver. This file handles parsing
// the rioku.yaml daemon configuration file into typed Go structs.
//
// Config precedence (lowest to highest): file < env vars < flags.
// Environment variable and flag overrides are handled at the CLI layer;
// this package is responsible only for file-based configuration and defaults.
package config

import (
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"gopkg.in/yaml.v3"
)

// DefaultConfigPath is the default location for the rioku.yaml config file.
const DefaultConfigPath = "/etc/rioku/rioku.yaml"

// DefaultDataDir is the default root data directory for Rioku state.
const DefaultDataDir = "/var/lib/rioku"

// --------------------------------------------------------------------------
// Top-level config
// --------------------------------------------------------------------------

// Config is the top-level representation of a rioku.yaml file.
type Config struct {
	Store           StoreConfig     `yaml:"store"`
	Listen          ListenConfig    `yaml:"listen"`
	Caddy           CaddyConfig     `yaml:"caddy"`
	PKI             PKIConfig       `yaml:"pki"`
	Traces          TracesConfig    `yaml:"traces"`
	AI              AIConfig        `yaml:"ai"`
	Auth            AuthConfig      `yaml:"auth"`
	SecurityHeaders SecurityHeaders `yaml:"security_headers"`
	Daemon          DaemonConfig    `yaml:"daemon"`
	DataDir         string          `yaml:"data_dir"`
	LogLevel        string          `yaml:"log_level"` // kept for backwards compat
	Logging         LoggingConfig   `yaml:"logging"`
}

// DaemonConfig collects daemon-level feature flags. These are
// orthogonal to the major subsystems and ship as boolean toggles.
//
// SideloadEnabled gates the plugin sideload endpoint. When false (the
// default) the daemon returns 404 from `POST /api/v1/t/{tenant}/plugins/sideload`
// and the admin panel hides the sideload route via the
// `/api/v1/capabilities` discovery endpoint. Set to true via the YAML
// `daemon.sideload_enabled: true` key OR the `RIOKU_SIDELOAD_ENABLED=1`
// env var.
type DaemonConfig struct {
	SideloadEnabled bool `yaml:"sideload_enabled"`
}

// SideloadEnabled reports whether plugin sideload is enabled. It
// returns true when either the YAML flag is set OR
// `RIOKU_SIDELOAD_ENABLED` env var is set to a truthy value
// ("1"/"true"/"yes", case-insensitive). Other values — including the
// empty string — return false.
//
// A nil receiver is safe and returns false.
func (c *Config) SideloadEnabled() bool {
	if c == nil {
		return envSideloadEnabled()
	}
	if c.Daemon.SideloadEnabled {
		return true
	}
	return envSideloadEnabled()
}

func envSideloadEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("RIOKU_SIDELOAD_ENABLED")))
	switch v {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// LoggingConfig controls daemon log output.
type LoggingConfig struct {
	Level       string        `yaml:"level"`
	Format      string        `yaml:"format"`
	Output      string        `yaml:"output"`
	File        LogFileConfig `yaml:"file"`
	OTLP        LogOTLPConfig `yaml:"otlp"`
	RedactRules []FilterRule  `yaml:"redact_rules"`
}

// FilterRule describes a single PII redaction rule applied to log
// records before they are emitted by downstream handlers. The rule
// type lives in the config package (and not in internal/logging) to
// avoid an import cycle: internal/logging already imports
// internal/config.
//
// Kind selects the redaction algorithm:
//
//   - "ip_mask"       — masks IP-typed or IP-string attribute values.
//     IPv4: zero the last octet. IPv6: zero the
//     last 64 bits.
//   - "hash"          — replaces the value with `sha256:<8-hex-prefix>`
//     of the original. Deterministic, so the same
//     input yields the same output across log lines
//     (correlation-safe).
//   - "cookie_redact" — when the attribute key matches `cookie` or
//     `set-cookie` (case-insensitive), parses the
//     cookie string and replaces VALUE portions with
//     `[redacted]` while preserving cookie names.
//
// Target is the exact attribute key the rule applies to. Glob matching
// (e.g. `request.headers.*`) is a planned follow-up; v1 honours exact
// match only.
//
// Params is reserved for future-facing rule configuration. v1 does not
// consume any params (kept for forward compatibility).
type FilterRule struct {
	Kind   string            `yaml:"kind"`
	Target string            `yaml:"target"`
	Params map[string]string `yaml:"params"`
}

// LogFileConfig controls file-based log output.
type LogFileConfig struct {
	Path string `yaml:"path"`
}

// LogOTLPConfig controls OTLP log shipping. When Enabled is false,
// no OTLP exporter is attached and logs flow only to the configured
// Output (stderr/file/both).
type LogOTLPConfig struct {
	// Enabled toggles OTLP log shipping. Default: false.
	Enabled bool `yaml:"enabled"`
	// Endpoint is the collector endpoint, e.g. "https://otel.example.com:4318"
	// for HTTP or "otel.example.com:4317" for gRPC.
	Endpoint string `yaml:"endpoint"`
	// Protocol is "http/protobuf" (default) or "grpc".
	Protocol string `yaml:"protocol"`
	// Headers is a map of HTTP/gRPC headers (e.g., authorization tokens).
	Headers map[string]string `yaml:"headers"`
	// Insecure disables TLS verification (use only for local collectors).
	Insecure bool `yaml:"insecure"`
	// ServiceName overrides the OTel resource service.name. Default:
	// "rioku-daemon".
	ServiceName string `yaml:"service_name"`
}

// --------------------------------------------------------------------------
// Store
// --------------------------------------------------------------------------

// StoreConfig selects and configures the persistence backend.
type StoreConfig struct {
	Driver   string         `yaml:"driver"`
	SQLite   SQLiteConfig   `yaml:"sqlite"`
	Postgres PostgresConfig `yaml:"postgres"`
	MySQL    MySQLConfig    `yaml:"mysql"`
	Raft     RaftConfig     `yaml:"raft"`
}

// RaftConfig holds settings for the embedded raft store driver.
type RaftConfig struct {
	NodeID    string `yaml:"node_id"`
	DataDir   string `yaml:"data_dir"`
	BindAddr  string `yaml:"bind_addr"`
	Bootstrap bool   `yaml:"bootstrap"`
}

// SQLiteConfig holds settings for the SQLite store driver.
type SQLiteConfig struct {
	Path string `yaml:"path"`
}

// PostgresConfig holds settings for the Postgres store driver.
type PostgresConfig struct {
	DSN             string        `yaml:"dsn"`
	MaxOpenConns    *int          `yaml:"max_open_conns"`
	MaxIdleConns    *int          `yaml:"max_idle_conns"`
	ConnMaxLifetime time.Duration `yaml:"conn_max_lifetime"`
}

// MySQLConfig holds settings for the MySQL/MariaDB store driver,
// including Galera cluster support.
type MySQLConfig struct {
	Galera                  bool          `yaml:"galera"`
	ExpectedClusterSize     int           `yaml:"expected_cluster_size"`
	Nodes                   []MySQLNode   `yaml:"nodes"`
	HealthPollInterval      time.Duration `yaml:"health_poll_interval"`
	CertFailureRetryMax     int           `yaml:"cert_failure_retry_max"`
	CertFailureRetryBackoff time.Duration `yaml:"cert_failure_retry_backoff"`
	MaxOpenConnsPerNode     *int          `yaml:"max_open_conns_per_node"`
	MaxIdleConnsPerNode     *int          `yaml:"max_idle_conns_per_node"`
	// DSN is used for single-node (non-Galera) MySQL setups.
	DSN string `yaml:"dsn"`
}

// MySQLNode represents a single node in a Galera cluster.
type MySQLNode struct {
	DSN string `yaml:"dsn"`
}

// --------------------------------------------------------------------------
// Listen
// --------------------------------------------------------------------------

// ListenConfig defines the addresses the daemon binds to.
type ListenConfig struct {
	GRPC         string `yaml:"grpc"`
	REST         string `yaml:"rest"`
	AdminDomain  string `yaml:"admin_domain"` // optional; dedicated domain for admin with auto-TLS
	InternalPort int    `yaml:"internal_port"`

	// TLSAskAddr is the loopback-only address the on-demand TLS `ask`
	// endpoint binds to. Caddy's TLS automation calls into this URL
	// during the TLS handshake to validate that an unknown SNI value
	// corresponds to a configured route — without it, anyone can DoS
	// our ACME issuance allowance. MUST be a loopback host (127.x.x.x,
	// ::1, or localhost). Default: "127.0.0.1:7790".
	TLSAskAddr string `yaml:"tls_ask_addr"`

	// KeyValidatorAddr is the loopback-only address the API-key
	// validation endpoint binds to (#179, #189). The rioku_apikey
	// Caddy module POSTs the SHA-256 hash of inbound keys here and
	// receives the resolved chain (Key → Subscription → Plan).
	// MUST be a loopback host. Default: "127.0.0.1:7791". Empty
	// disables the endpoint — Caddy plugins that depend on it must
	// configure their own validator endpoint when this is off.
	KeyValidatorAddr string `yaml:"key_validator_addr"`

	// AIGatewayAddr is the loopback-only address the daemon-side AI
	// gateway HTTP server binds to (D7, #168). Caddy reverse-proxies
	// to this port for AI routes (/v1/chat/completions etc.). MUST be
	// a loopback host. Default: "127.0.0.1:7792". Empty disables the
	// AI gateway — operators with no AI routes can leave it off.
	AIGatewayAddr string `yaml:"ai_gateway_addr"`
}

// --------------------------------------------------------------------------
// Caddy
// --------------------------------------------------------------------------

// CaddyConfig controls the managed Caddy child process.
type CaddyConfig struct {
	Binary       string   `yaml:"binary"`
	AdminAddr    string   `yaml:"admin_addr"`
	DataDir      string   `yaml:"data_dir"`
	TrafficAddrs []string `yaml:"traffic_addrs"` // listen addresses for user traffic server block (default: [":443"])

	// OnDemandTLS turns on Caddy's on-demand TLS automation: instead of
	// pre-provisioning certificates for every configured route, Caddy
	// provisions them on the first TLS handshake for an unknown SNI.
	// When true, the compiler injects an `apps.tls.automation.on_demand.ask`
	// URL pointing at the daemon's local /tls/ask endpoint so we gate
	// which domains Caddy is willing to issue for. See #66.
	OnDemandTLS bool `yaml:"on_demand_tls"`
}

// --------------------------------------------------------------------------
// PKI
// --------------------------------------------------------------------------

// PKIConfig controls the internal certificate authority and certificate
// lifecycle for node mTLS and database client certs.
type PKIConfig struct {
	Dir  string        `yaml:"dir"`
	CA   PKICAConfig   `yaml:"ca"`
	Node PKINodeConfig `yaml:"node"`
	DB   PKIDBConfig   `yaml:"db"`
}

// PKICAConfig holds settings for the root CA.
type PKICAConfig struct {
	KeyAlgorithm        string        `yaml:"key_algorithm"`
	Validity            time.Duration `yaml:"validity"`
	KeyPassphraseSource string        `yaml:"key_passphrase_source"`
}

// PKINodeConfig holds settings for node (mTLS) certificates.
type PKINodeConfig struct {
	Validity          time.Duration `yaml:"validity"`
	RotationThreshold time.Duration `yaml:"rotation_threshold"`
	SANs              PKISANs       `yaml:"sans"`
}

// PKISANs defines Subject Alternative Names for node certificates.
type PKISANs struct {
	DNS []string `yaml:"dns"`
	IP  []string `yaml:"ip"`
}

// PKIDBConfig holds settings for database client certificates.
type PKIDBConfig struct {
	Validity          time.Duration `yaml:"validity"`
	RotationThreshold time.Duration `yaml:"rotation_threshold"`
	GaleraCN          string        `yaml:"galera_cn"`
	PostgresCN        string        `yaml:"postgres_cn"`
}

// --------------------------------------------------------------------------
// Traces
// --------------------------------------------------------------------------

// TracesConfig controls the request trace persistence layer.
type TracesConfig struct {
	Store      string          `yaml:"store"`
	Path       string          `yaml:"path"`
	BufferSize int             `yaml:"buffer_size"`
	Retention  TracesRetention `yaml:"retention"`
	Sampling   TracesSampling  `yaml:"sampling"`
	Content    TracesContent   `yaml:"content"`
	MaxSizeGB  *float64        `yaml:"max_size_gb"`
}

// TracesRetention defines how long different trace categories are kept.
type TracesRetention struct {
	RequestTraces time.Duration `yaml:"request_traces"`
	AISessions    time.Duration `yaml:"ai_sessions"`
	Aggregates    time.Duration `yaml:"aggregates"`
}

// TracesSampling controls trace collection rates.
type TracesSampling struct {
	Rate          *float64 `yaml:"rate"`
	ErrorsAlways  bool     `yaml:"errors_always"`
	AIAlways      bool     `yaml:"ai_always"`
	MinDurationMS *int     `yaml:"min_duration_ms"`
}

// TracesContent controls what request content is stored in traces.
type TracesContent struct {
	StoreMessages  bool     `yaml:"store_messages"`
	RedactPatterns []string `yaml:"redact_patterns"`
}

// --------------------------------------------------------------------------
// AI
// --------------------------------------------------------------------------

// AIConfig controls AI-related features like pricing feeds.
type AIConfig struct {
	Pricing AIPricingConfig `yaml:"pricing"`
}

// AIPricingConfig controls the model pricing table.
type AIPricingConfig struct {
	AutoUpdate     bool              `yaml:"auto_update"`
	FeedURL        string            `yaml:"feed_url"`
	UpdateInterval time.Duration     `yaml:"update_interval"`
	Overrides      map[string]string `yaml:"overrides"`
	Custom         []interface{}     `yaml:"custom"`
	Currency       string            `yaml:"currency"`
}

// --------------------------------------------------------------------------
// Auth
// --------------------------------------------------------------------------

// PasswordPolicy defines complexity and lifetime rules for user passwords.
type PasswordPolicy struct {
	MinLength        int  `yaml:"min_length"`
	RequireUppercase bool `yaml:"require_uppercase"`
	RequireLowercase bool `yaml:"require_lowercase"`
	RequireDigit     bool `yaml:"require_digit"`
	RequireSpecial   bool `yaml:"require_special"`
	MaxAgeDays       int  `yaml:"max_age_days"`
	HistoryCount     int  `yaml:"history_count"`
}

// LockoutPolicy defines account lockout behavior on repeated auth failures.
type LockoutPolicy struct {
	MaxAttempts     int           `yaml:"max_attempts"`
	LockoutDuration time.Duration `yaml:"lockout_duration"`
	ResetAfter      time.Duration `yaml:"reset_after"`
}

// AuthConfig holds all auth-related daemon configuration.
type AuthConfig struct {
	PasswordPolicy PasswordPolicy  `yaml:"password_policy"`
	Lockout        LockoutPolicy   `yaml:"lockout"`
	DevMode        bool            `yaml:"dev_mode"`
	RateLimit      RateLimitConfig `yaml:"rate_limit"`
	CORS           CORSConfig      `yaml:"cors"`
}

// RateLimitConfig defines per-endpoint or global request rate limiting.
type RateLimitConfig struct {
	RequestsPerMinute int  `yaml:"requests_per_minute"`
	BurstSize         int  `yaml:"burst_size"`
	ByIP              bool `yaml:"by_ip"`
	BySession         bool `yaml:"by_session"`
	ByUser            bool `yaml:"by_user"`
}

// CORSConfig defines Cross-Origin Resource Sharing settings for the REST API.
type CORSConfig struct {
	AllowedOrigins []string `yaml:"allowed_origins"`
	AllowedMethods []string `yaml:"allowed_methods"`
	AllowedHeaders []string `yaml:"allowed_headers"`
	MaxAge         int      `yaml:"max_age"` // seconds
}

// --------------------------------------------------------------------------
// Security Headers
// --------------------------------------------------------------------------

// SecurityHeaders controls the security response headers that the gateway
// injects into every proxied response. Defaults follow OWASP recommendations.
type SecurityHeaders struct {
	Enabled             bool       `yaml:"enabled"`
	XContentTypeOptions string     `yaml:"x_content_type_options"`
	XFrameOptions       string     `yaml:"x_frame_options"`
	ReferrerPolicy      string     `yaml:"referrer_policy"`
	PermissionsPolicy   string     `yaml:"permissions_policy"`
	CSP                 string     `yaml:"csp"`
	CSPReportOnly       bool       `yaml:"csp_report_only"`
	HSTS                HSTSConfig `yaml:"hsts"`
}

// HSTSConfig controls the HTTP Strict Transport Security header.
type HSTSConfig struct {
	Enabled           bool `yaml:"enabled"`
	MaxAge            int  `yaml:"max_age"`
	IncludeSubdomains bool `yaml:"include_subdomains"`
}

// --------------------------------------------------------------------------
// Defaults
// --------------------------------------------------------------------------

// Default returns a Config populated with sensible defaults suitable for
// local development (e.g., "rku init"). It uses SQLite, localhost listen
// addresses, and the standard /var/lib/rioku data directory.
func Default() *Config {
	maxOpenConns := 25
	maxIdleConns := 5
	maxOpenConnsPerNode := 10
	maxIdleConnsPerNode := 2
	samplingRate := 1.0
	minDurationMS := 0
	maxSizeGB := 10.0

	return &Config{
		Store: StoreConfig{
			Driver: "raft",
			SQLite: SQLiteConfig{
				Path: DefaultDataDir + "/rioku.db",
			},
			Raft: RaftConfig{
				NodeID:    "node-0",
				BindAddr:  "127.0.0.1:7779",
				Bootstrap: true,
			},
			Postgres: PostgresConfig{
				MaxOpenConns:    &maxOpenConns,
				MaxIdleConns:    &maxIdleConns,
				ConnMaxLifetime: 5 * time.Minute,
			},
			MySQL: MySQLConfig{
				HealthPollInterval:      2 * time.Second,
				CertFailureRetryMax:     3,
				CertFailureRetryBackoff: 100 * time.Millisecond,
				MaxOpenConnsPerNode:     &maxOpenConnsPerNode,
				MaxIdleConnsPerNode:     &maxIdleConnsPerNode,
			},
		},
		Listen: ListenConfig{
			GRPC:             ":7777",
			REST:             ":7778",
			InternalPort:     7780,
			TLSAskAddr:       "127.0.0.1:7790",
			KeyValidatorAddr: "127.0.0.1:7791",
			AIGatewayAddr:    "127.0.0.1:7792",
		},
		Caddy: CaddyConfig{
			Binary:       "caddy",
			AdminAddr:    "localhost:2019",
			DataDir:      DefaultDataDir + "/caddy",
			TrafficAddrs: []string{":443"},
		},
		PKI: PKIConfig{
			Dir: DefaultDataDir + "/pki",
			CA: PKICAConfig{
				KeyAlgorithm:        "ecdsa-p256",
				Validity:            87600 * time.Hour, // 10 years
				KeyPassphraseSource: "auto",
			},
			Node: PKINodeConfig{
				Validity:          8760 * time.Hour, // 1 year
				RotationThreshold: 720 * time.Hour,  // 30 days
			},
			DB: PKIDBConfig{
				Validity:          8760 * time.Hour,
				RotationThreshold: 720 * time.Hour,
				GaleraCN:          "rioku-galera-client",
				PostgresCN:        "rioku-pg-client",
			},
		},
		Traces: TracesConfig{
			Store:      "sqlite",
			Path:       DefaultDataDir + "/traces",
			BufferSize: 10000,
			Retention: TracesRetention{
				RequestTraces: 7 * 24 * time.Hour,  // 7d
				AISessions:    30 * 24 * time.Hour, // 30d
				Aggregates:    90 * 24 * time.Hour, // 90d
			},
			Sampling: TracesSampling{
				Rate:          &samplingRate,
				ErrorsAlways:  true,
				AIAlways:      true,
				MinDurationMS: &minDurationMS,
			},
			Content: TracesContent{
				StoreMessages: false,
				RedactPatterns: []string{
					`\b\d{4}[-]?\d{4}[-]?\d{4}[-]?\d{4}\b`,
					`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b`,
				},
			},
			MaxSizeGB: &maxSizeGB,
		},
		AI: AIConfig{
			Pricing: AIPricingConfig{
				AutoUpdate:     false,
				FeedURL:        "https://pricing.rioku.dev/table.json",
				UpdateInterval: 24 * time.Hour,
				Overrides:      map[string]string{},
				Custom:         []interface{}{},
				Currency:       "USD",
			},
		},
		Auth: AuthConfig{
			PasswordPolicy: PasswordPolicy{
				MinLength:        12,
				RequireUppercase: true,
				RequireLowercase: true,
				RequireDigit:     true,
				RequireSpecial:   false,
				MaxAgeDays:       0,
				HistoryCount:     0,
			},
			Lockout: LockoutPolicy{
				MaxAttempts:     5,
				LockoutDuration: 15 * time.Minute,
				ResetAfter:      30 * time.Minute,
			},
			RateLimit: RateLimitConfig{
				RequestsPerMinute: 60,
				BurstSize:         10,
				ByIP:              true,
				BySession:         false,
				ByUser:            false,
			},
			CORS: CORSConfig{
				AllowedOrigins: []string{},
				AllowedMethods: []string{"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"},
				AllowedHeaders: []string{"Content-Type", "Authorization", "X-Request-ID"},
				MaxAge:         3600,
			},
		},
		SecurityHeaders: SecurityHeaders{
			Enabled:             true,
			XContentTypeOptions: "nosniff",
			XFrameOptions:       "DENY",
			ReferrerPolicy:      "strict-origin-when-cross-origin",
			PermissionsPolicy:   "camera=(), microphone=(), geolocation=()",
			CSP:                 "",
			HSTS: HSTSConfig{
				Enabled:           true,
				MaxAge:            63072000,
				IncludeSubdomains: true,
			},
		},
		DataDir:  DefaultDataDir,
		LogLevel: "info",
	}
}

// --------------------------------------------------------------------------
// Load
// --------------------------------------------------------------------------

// Load reads the rioku.yaml file at the given path, parses it into a
// Config struct, applies defaults for any unset fields, and validates
// required values. If path is empty, DefaultConfigPath is used.
func Load(path string) (*Config, error) {
	if path == "" {
		path = DefaultConfigPath
	}

	// Warn if config file is world-readable (may contain DB credentials).
	if info, err := os.Stat(path); err == nil {
		if info.Mode().Perm()&0o004 != 0 {
			fmt.Fprintf(os.Stderr, "warning: config file %s is world-readable (mode %o), consider chmod 640\n", path, info.Mode().Perm())
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("config: reading %s: %w", path, err)
	}

	cfg := Default()
	if err := yaml.Unmarshal(data, cfg); err != nil {
		return nil, fmt.Errorf("config: parsing %s: %w", path, err)
	}

	applyDefaults(cfg)

	if err := validate(cfg); err != nil {
		return nil, fmt.Errorf("config: validating %s: %w", path, err)
	}

	return cfg, nil
}

// --------------------------------------------------------------------------
// Defaults application
// --------------------------------------------------------------------------

// applyDefaults fills in zero-valued fields with sensible defaults.
// Because we unmarshal on top of Default(), most fields are already set.
// This function handles conditional logic that Default() alone cannot.
func applyDefaults(cfg *Config) {
	if cfg.DataDir == "" {
		cfg.DataDir = DefaultDataDir
	}

	// Derive paths from DataDir if they were not explicitly set and still
	// carry the compile-time default (i.e., user changed data_dir but not
	// the sub-paths).
	if cfg.Store.Driver == "sqlite" && cfg.Store.SQLite.Path == "" {
		cfg.Store.SQLite.Path = cfg.DataDir + "/rioku.db"
	}
	if cfg.Store.Driver == "raft" {
		if cfg.Store.Raft.DataDir == "" {
			cfg.Store.Raft.DataDir = cfg.DataDir + "/raft"
		}
		if cfg.Store.Raft.NodeID == "" {
			cfg.Store.Raft.NodeID = "node-0"
		}
		if cfg.Store.Raft.BindAddr == "" {
			cfg.Store.Raft.BindAddr = "127.0.0.1:7779"
		}
	}
	if cfg.Caddy.DataDir == "" {
		cfg.Caddy.DataDir = cfg.DataDir + "/caddy"
	}
	if cfg.PKI.Dir == "" {
		cfg.PKI.Dir = cfg.DataDir + "/pki"
	}
	if cfg.Traces.Path == "" || cfg.Traces.Path == DefaultDataDir+"/traces" {
		cfg.Traces.Path = cfg.DataDir + "/traces"
	}

	if cfg.Listen.GRPC == "" {
		cfg.Listen.GRPC = ":7777"
	}
	if cfg.Listen.REST == "" {
		cfg.Listen.REST = ":7778"
	}
	if cfg.Caddy.Binary == "" {
		cfg.Caddy.Binary = "caddy"
	}
	if cfg.Caddy.AdminAddr == "" {
		cfg.Caddy.AdminAddr = "localhost:2019"
	}
	if cfg.LogLevel == "" {
		cfg.LogLevel = "info"
	}
	// Logging: resolve log_level vs logging.level
	if cfg.Logging.Level == "" {
		if cfg.LogLevel != "" {
			cfg.Logging.Level = cfg.LogLevel
		} else {
			cfg.Logging.Level = "info"
		}
	}
	if cfg.Logging.Format == "" {
		cfg.Logging.Format = "auto"
	}
	if cfg.Logging.Output == "" {
		cfg.Logging.Output = "stderr"
	}
	if cfg.Logging.File.Path == "" {
		cfg.Logging.File.Path = "/var/log/rioku/daemon.log"
	}
	// Apply env var overrides after file defaults but before validation.
	if v := os.Getenv("RIOKU_LOG_LEVEL"); v != "" {
		cfg.Logging.Level = v
	}
	if v := os.Getenv("RIOKU_LOG_FORMAT"); v != "" {
		cfg.Logging.Format = v
	}
	if v := os.Getenv("RIOKU_LOG_OUTPUT"); v != "" {
		cfg.Logging.Output = v
	}
	if cfg.Store.Driver == "" {
		cfg.Store.Driver = "raft"
	}
	if cfg.Traces.Store == "" {
		cfg.Traces.Store = "sqlite"
	}
	if cfg.Traces.BufferSize == 0 {
		cfg.Traces.BufferSize = 10000
	}
	if cfg.PKI.CA.KeyAlgorithm == "" {
		cfg.PKI.CA.KeyAlgorithm = "ecdsa-p256"
	}
	if cfg.PKI.CA.KeyPassphraseSource == "" {
		cfg.PKI.CA.KeyPassphraseSource = "auto"
	}
	if cfg.PKI.DB.GaleraCN == "" {
		cfg.PKI.DB.GaleraCN = "rioku-galera-client"
	}
	if cfg.PKI.DB.PostgresCN == "" {
		cfg.PKI.DB.PostgresCN = "rioku-pg-client"
	}
	if cfg.AI.Pricing.FeedURL == "" {
		cfg.AI.Pricing.FeedURL = "https://pricing.rioku.dev/table.json"
	}
	if cfg.AI.Pricing.Currency == "" {
		cfg.AI.Pricing.Currency = "USD"
	}
	if cfg.AI.Pricing.Overrides == nil {
		cfg.AI.Pricing.Overrides = map[string]string{}
	}
	if cfg.AI.Pricing.Custom == nil {
		cfg.AI.Pricing.Custom = []interface{}{}
	}
}

// --------------------------------------------------------------------------
// Validation
// --------------------------------------------------------------------------

// validStoreDrivers is the set of allowed store.driver values.
var validStoreDrivers = map[string]bool{
	"raft":     true,
	"sqlite":   true,
	"postgres": true,
	"mysql":    true,
}

// validLogLevels is the set of allowed log_level values.
var validLogLevels = map[string]bool{
	"debug": true,
	"info":  true,
	"warn":  true,
	"error": true,
}

// validTraceStores is the set of allowed traces.store values.
var validTraceStores = map[string]bool{
	"sqlite": true,
	"duckdb": true,
}

// validKeyAlgorithms is the set of allowed pki.ca.key_algorithm values.
var validKeyAlgorithms = map[string]bool{
	"ecdsa-p256": true,
	"ecdsa-p384": true,
	"rsa-2048":   true,
	"rsa-4096":   true,
	"ed25519":    true,
}

// validPassphraseSources is the set of allowed pki.ca.key_passphrase_source values.
var validPassphraseSources = map[string]bool{
	"auto":           true,
	"systemd-creds":  true,
	"kernel-keyring": true,
	"env":            true,
	"encrypted-file": true,
}

// isLoopbackAddr reports whether addr binds only to a loopback host.
// Accepts host:port shapes ("127.0.0.1:7791"), bracket-wrapped IPv6
// ("[::1]:7791"), or bare hostnames ("localhost:7791"). Empty host
// means INADDR_ANY ("0.0.0.0" / ":7791") and is rejected.
func isLoopbackAddr(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		// Treat malformed addresses as non-loopback so the operator
		// has to fix the syntax before the daemon binds.
		return false
	}
	if host == "" {
		// Bare ":7791" listens on all interfaces.
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		// Non-localhost hostname — reject; the daemon would resolve
		// it via DNS at bind time and we can't safely promise the
		// address is loopback without that lookup.
		return false
	}
	return ip.IsLoopback()
}

// validate checks the config for required fields, valid enum values,
// and internal consistency.
func validate(cfg *Config) error {
	var errs []error

	// store.driver
	if cfg.Store.Driver == "" {
		errs = append(errs, errors.New("store.driver is required"))
	} else if !validStoreDrivers[cfg.Store.Driver] {
		errs = append(errs, fmt.Errorf("store.driver %q is not valid; must be one of: raft, sqlite, postgres, mysql", cfg.Store.Driver))
	}

	// Driver-specific validation.
	switch cfg.Store.Driver {
	case "raft":
		if cfg.Store.Raft.BindAddr == "" {
			errs = append(errs, errors.New("store.raft.bind_addr is required when driver is raft"))
		}
	case "sqlite":
		if cfg.Store.SQLite.Path == "" {
			errs = append(errs, errors.New("store.sqlite.path is required when driver is sqlite"))
		}
	case "postgres":
		if cfg.Store.Postgres.DSN == "" {
			errs = append(errs, errors.New("store.postgres.dsn is required when driver is postgres"))
		}
	case "mysql":
		if cfg.Store.MySQL.Galera {
			if len(cfg.Store.MySQL.Nodes) == 0 {
				errs = append(errs, errors.New("store.mysql.nodes must have at least one entry when galera is true"))
			}
			for i, node := range cfg.Store.MySQL.Nodes {
				if node.DSN == "" {
					errs = append(errs, fmt.Errorf("store.mysql.nodes[%d].dsn is required", i))
				}
			}
		} else {
			if cfg.Store.MySQL.DSN == "" && len(cfg.Store.MySQL.Nodes) == 0 {
				errs = append(errs, errors.New("store.mysql.dsn or store.mysql.nodes is required when driver is mysql"))
			}
		}
	}

	// log_level (backwards compat check)
	if cfg.LogLevel != "" && !validLogLevels[cfg.LogLevel] {
		errs = append(errs, fmt.Errorf("log_level %q is not valid; must be one of: debug, info, warn, error", cfg.LogLevel))
	}
	// logging block validation
	switch cfg.Logging.Level {
	case "debug", "info", "warn", "error":
		// valid
	default:
		errs = append(errs, fmt.Errorf("logging.level: must be debug, info, warn, or error (got %q)", cfg.Logging.Level))
	}
	switch cfg.Logging.Format {
	case "auto", "json", "text":
		// valid
	default:
		errs = append(errs, fmt.Errorf("logging.format: must be auto, json, or text (got %q)", cfg.Logging.Format))
	}
	switch cfg.Logging.Output {
	case "stderr", "file", "both":
		// valid
	default:
		errs = append(errs, fmt.Errorf("logging.output: must be stderr, file, or both (got %q)", cfg.Logging.Output))
	}
	if (cfg.Logging.Output == "file" || cfg.Logging.Output == "both") && cfg.Logging.File.Path == "" {
		errs = append(errs, fmt.Errorf("logging.file.path: required when output is %q", cfg.Logging.Output))
	}
	// OTLP logging validation (only when enabled).
	if cfg.Logging.OTLP.Enabled {
		if cfg.Logging.OTLP.Endpoint == "" {
			errs = append(errs, fmt.Errorf("logging.otlp.endpoint: required when otlp is enabled"))
		}
		switch cfg.Logging.OTLP.Protocol {
		case "", "http/protobuf", "grpc":
			// valid
		default:
			errs = append(errs, fmt.Errorf("logging.otlp.protocol: must be http/protobuf or grpc (got %q)", cfg.Logging.OTLP.Protocol))
		}
	}

	// traces.store
	if cfg.Traces.Store != "" && !validTraceStores[cfg.Traces.Store] {
		errs = append(errs, fmt.Errorf("traces.store %q is not valid; must be one of: sqlite, duckdb", cfg.Traces.Store))
	}

	// pki.ca.key_algorithm
	if cfg.PKI.CA.KeyAlgorithm != "" && !validKeyAlgorithms[cfg.PKI.CA.KeyAlgorithm] {
		errs = append(errs, fmt.Errorf(
			"pki.ca.key_algorithm %q is not valid; must be one of: ecdsa-p256, ecdsa-p384, rsa-2048, rsa-4096, ed25519",
			cfg.PKI.CA.KeyAlgorithm,
		))
	}

	// pki.ca.key_passphrase_source
	if cfg.PKI.CA.KeyPassphraseSource != "" && !validPassphraseSources[cfg.PKI.CA.KeyPassphraseSource] {
		errs = append(errs, fmt.Errorf(
			"pki.ca.key_passphrase_source %q is not valid; must be one of: auto, systemd-creds, kernel-keyring, env, encrypted-file",
			cfg.PKI.CA.KeyPassphraseSource,
		))
	}

	// listen addresses must not be empty
	if cfg.Listen.GRPC == "" {
		errs = append(errs, errors.New("listen.grpc address is required"))
	}
	if cfg.Listen.REST == "" {
		errs = append(errs, errors.New("listen.rest address is required"))
	}

	// Loopback-only listeners. The keyvalidator + AI gateway + tls-ask
	// endpoints carry no auth themselves — network-level isolation
	// IS the trust boundary. Refuse to start if an operator binds them
	// to a non-loopback host (an unauth key-validation oracle / AI
	// proxy / TLS issuance bypass exposed on the network).
	for _, lb := range []struct {
		field, addr string
	}{
		{"listen.tls_ask_addr", cfg.Listen.TLSAskAddr},
		{"listen.key_validator_addr", cfg.Listen.KeyValidatorAddr},
		{"listen.ai_gateway_addr", cfg.Listen.AIGatewayAddr},
	} {
		if lb.addr == "" {
			continue
		}
		if !isLoopbackAddr(lb.addr) {
			errs = append(errs, fmt.Errorf(
				"%s = %q must bind to a loopback host (127.0.0.0/8, ::1, or localhost) — these endpoints carry no auth and rely on network isolation",
				lb.field, lb.addr))
		}
	}

	// data_dir must not be empty
	if cfg.DataDir == "" {
		errs = append(errs, errors.New("data_dir is required"))
	}

	// sampling rate must be in [0, 1]
	if cfg.Traces.Sampling.Rate != nil {
		r := *cfg.Traces.Sampling.Rate
		if r < 0 || r > 1 {
			errs = append(errs, fmt.Errorf("traces.sampling.rate must be between 0.0 and 1.0, got %v", r))
		}
	}

	// max_size_gb must be positive
	if cfg.Traces.MaxSizeGB != nil && *cfg.Traces.MaxSizeGB <= 0 {
		errs = append(errs, fmt.Errorf("traces.max_size_gb must be positive, got %v", *cfg.Traces.MaxSizeGB))
	}

	if len(errs) == 0 {
		return nil
	}
	return errors.Join(errs...)
}
