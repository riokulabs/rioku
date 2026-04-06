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
	"os"
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
	Store    StoreConfig  `yaml:"store"`
	Listen   ListenConfig `yaml:"listen"`
	Caddy    CaddyConfig  `yaml:"caddy"`
	PKI      PKIConfig    `yaml:"pki"`
	Traces   TracesConfig `yaml:"traces"`
	AI       AIConfig     `yaml:"ai"`
	DataDir  string       `yaml:"data_dir"`
	LogLevel string       `yaml:"log_level"`
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
	GRPC string `yaml:"grpc"`
	REST string `yaml:"rest"`
}

// --------------------------------------------------------------------------
// Caddy
// --------------------------------------------------------------------------

// CaddyConfig controls the managed Caddy child process.
type CaddyConfig struct {
	Binary    string `yaml:"binary"`
	AdminAddr string `yaml:"admin_addr"`
	DataDir   string `yaml:"data_dir"`
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
	Store     string          `yaml:"store"`
	Path      string          `yaml:"path"`
	Retention TracesRetention `yaml:"retention"`
	Sampling  TracesSampling  `yaml:"sampling"`
	Content   TracesContent   `yaml:"content"`
	MaxSizeGB *float64        `yaml:"max_size_gb"`
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
			Driver: "sqlite",
			SQLite: SQLiteConfig{
				Path: DefaultDataDir + "/rioku.db",
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
			GRPC: ":7777",
			REST: ":7778",
		},
		Caddy: CaddyConfig{
			Binary:    "caddy",
			AdminAddr: "localhost:2019",
			DataDir:   DefaultDataDir + "/caddy",
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
			Store: "sqlite",
			Path:  DefaultDataDir + "/traces",
			Retention: TracesRetention{
				RequestTraces: 7 * 24 * time.Hour,  // 7d
				AISessions:    30 * 24 * time.Hour, // 30d
				Aggregates:    90 * 24 * time.Hour, // 90d
			},
			Sampling: TracesSampling{
				Rate:          &samplingRate,
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
	if cfg.Caddy.DataDir == "" {
		cfg.Caddy.DataDir = cfg.DataDir + "/caddy"
	}
	if cfg.PKI.Dir == "" {
		cfg.PKI.Dir = cfg.DataDir + "/pki"
	}
	if cfg.Traces.Path == "" {
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
	if cfg.Store.Driver == "" {
		cfg.Store.Driver = "sqlite"
	}
	if cfg.Traces.Store == "" {
		cfg.Traces.Store = "sqlite"
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

// validate checks the config for required fields, valid enum values,
// and internal consistency.
func validate(cfg *Config) error {
	var errs []error

	// store.driver
	if cfg.Store.Driver == "" {
		errs = append(errs, errors.New("store.driver is required"))
	} else if !validStoreDrivers[cfg.Store.Driver] {
		errs = append(errs, fmt.Errorf("store.driver %q is not valid; must be one of: sqlite, postgres, mysql", cfg.Store.Driver))
	}

	// Driver-specific validation.
	switch cfg.Store.Driver {
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

	// log_level
	if cfg.LogLevel != "" && !validLogLevels[cfg.LogLevel] {
		errs = append(errs, fmt.Errorf("log_level %q is not valid; must be one of: debug, info, warn, error", cfg.LogLevel))
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
