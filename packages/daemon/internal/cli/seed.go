package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// ---------------------------------------------------------------------------
// Seed file data model
// ---------------------------------------------------------------------------

// SeedFile represents the top-level structure of a seed YAML file.
//
// Stage-2 entities (Sites onward) target tenant-scoped REST paths
// `/api/v1/t/{tenant}/...`. The optional Tenant field on each entity
// selects which tenant; defaults to "default" if unset.
type SeedFile struct {
	// Legacy + identity (tenant-implicit; default tenant only)
	Roles    []SeedRole    `yaml:"roles"`
	Services []SeedService `yaml:"services"`
	Policies []SeedPolicy  `yaml:"policies"`
	Routes   []SeedRoute   `yaml:"routes"`
	Users    []SeedUser    `yaml:"users"`
	APIKeys  []SeedAPIKey  `yaml:"api_keys"`

	// Stage-2 entities (tenant-scoped). Tenants block creates extra
	// tenants beyond the seeded "default"; everything below uses the
	// per-entity Tenant field (defaults to "default").
	Tenants              []SeedTenant              `yaml:"tenants"`
	Memberships          []SeedMembership          `yaml:"memberships"`
	Sites                []SeedSite                `yaml:"sites"`
	Middlewares          []SeedMiddleware          `yaml:"middlewares"`
	Dashboards           []SeedDashboard           `yaml:"dashboards"`
	AIProviders          []SeedAIProvider          `yaml:"ai_providers"`
	AIAgents             []SeedAIAgent             `yaml:"ai_agents"`
	AITools              []SeedAITool              `yaml:"ai_tools"`
	AIToolBindings       []SeedAIToolBinding       `yaml:"ai_tool_bindings"`
	AIRateLimits         []SeedAIRateLimit         `yaml:"ai_rate_limits"`
	MCPServers           []SeedMCPServer           `yaml:"mcp_servers"`
	NotificationChannels []SeedNotifChannel        `yaml:"notification_channels"`
	NotificationRouting  []SeedNotifRoutingRule    `yaml:"notification_routing"`
	Plugins              []SeedPlugin              `yaml:"plugins"`
	PluginSigners        []SeedPluginSigner        `yaml:"plugin_signers"`
	CertAuthorities      []SeedCertAuthority       `yaml:"cert_authorities"`
	CertEnrollments      []SeedCertEnrollment      `yaml:"cert_enrollments"`
	TLSCertificates      []SeedTLSCertificate      `yaml:"tls_certificates"`
	TLSConfig            *SeedTLSConfig            `yaml:"tls_config"`
	NetworkConfig        *SeedNetworkConfig        `yaml:"network_config"`
	AuthPolicy           *SeedAuthPolicy           `yaml:"auth_policy"`
	ObservabilityConfig  *SeedObservabilityConfig  `yaml:"observability_config"`
	AuditRetentionConfig *SeedAuditRetentionConfig `yaml:"audit_retention"`
	NotificationConfig   *SeedNotificationConfig   `yaml:"notification_config"`
	WebhookEndpoints     []SeedWebhookEndpoint     `yaml:"webhook_endpoints"`
}

// SeedRole defines a custom role to create.
type SeedRole struct {
	Name        string `yaml:"name"`
	Description string `yaml:"description"`
}

// SeedService defines an upstream service.
type SeedService struct {
	Name      string         `yaml:"name"`
	Upstreams []SeedUpstream `yaml:"upstreams"`
	LBPolicy  string         `yaml:"lb_policy"`
}

// SeedUpstream is a single upstream address.
type SeedUpstream struct {
	Address string `yaml:"address"`
}

// SeedPolicy defines a traffic policy.
type SeedPolicy struct {
	Name   string         `yaml:"name"`
	Type   string         `yaml:"type"`
	Config map[string]any `yaml:"config"`
}

// SeedRoute defines a route referencing services and policies by name.
type SeedRoute struct {
	Name     string             `yaml:"name"`
	Enabled  *bool              `yaml:"enabled,omitempty"`
	Matchers []SeedRouteMatcher `yaml:"matchers"`
	Service  string             `yaml:"service"`
	Policies []string           `yaml:"policies"`
}

// SeedRouteMatcher mirrors the route matcher schema used by the REST API.
type SeedRouteMatcher struct {
	Hosts   []string       `yaml:"hosts,omitempty"`
	Paths   []SeedPathRule `yaml:"paths,omitempty"`
	Methods []string       `yaml:"methods,omitempty"`
}

// SeedPathRule defines a path match rule (type + value).
type SeedPathRule struct {
	Type  string `yaml:"type"`
	Value string `yaml:"value"`
}

// SeedUser defines a test user to create.
type SeedUser struct {
	Username string   `yaml:"username"`
	Password string   `yaml:"password"`
	Roles    []string `yaml:"roles"`
	Status   string   `yaml:"status,omitempty"`
}

// SeedAPIKey defines an API key to create.
type SeedAPIKey struct {
	Name   string   `yaml:"name"`
	Scopes []string `yaml:"scopes"`
}

// ---------------------------------------------------------------------------
// Stage-2 entity seed types
//
// Each tenant-scoped entity carries a `Tenant` field that defaults to
// "default" when unset. POSTs hit `/api/v1/t/{tenant}/...`.
// ---------------------------------------------------------------------------

// SeedTenant creates an extra tenant beyond the seeded "default".
type SeedTenant struct {
	Slug         string `yaml:"slug"`
	Name         string `yaml:"name"`
	Plan         string `yaml:"plan,omitempty"`
	URLMode      string `yaml:"url_mode,omitempty"`
	ParentDomain string `yaml:"parent_domain,omitempty"`
}

// SeedMembership ties a username to a tenant with a role set.
type SeedMembership struct {
	Tenant   string   `yaml:"tenant,omitempty"`
	Username string   `yaml:"username"`
	State    string   `yaml:"state,omitempty"` // pending|active|deactivated
	Roles    []string `yaml:"roles,omitempty"` // role names; resolved to ids at apply time
}

// SeedSite is a per-tenant gateway entry.
type SeedSite struct {
	Tenant            string `yaml:"tenant,omitempty"`
	Name              string `yaml:"name"`
	Domain            string `yaml:"domain"`
	TLSMode           string `yaml:"tls_mode,omitempty"`
	UpstreamServiceID string `yaml:"upstream_service_id,omitempty"`
	BasicAuthEnabled  bool   `yaml:"basic_auth_enabled,omitempty"`
	BasicAuthRealm    string `yaml:"basic_auth_realm,omitempty"`
	RateLimitPreset   string `yaml:"rate_limit_preset,omitempty"`
}

// SeedMiddleware is a per-tenant reusable handler-stack component.
type SeedMiddleware struct {
	Tenant    string         `yaml:"tenant,omitempty"`
	Name      string         `yaml:"name"`
	Kind      string         `yaml:"kind"`
	Config    map[string]any `yaml:"config,omitempty"`
	OrderHint int32          `yaml:"order_hint,omitempty"`
}

// SeedDashboard is a per-tenant analytics surface.
type SeedDashboard struct {
	Tenant      string       `yaml:"tenant,omitempty"`
	Name        string       `yaml:"name"`
	Description string       `yaml:"description,omitempty"`
	Mode        string       `yaml:"mode,omitempty"`
	Scope       string       `yaml:"scope,omitempty"`
	Widgets     []SeedWidget `yaml:"widgets,omitempty"`
}

// SeedWidget is a tile inside a dashboard.
type SeedWidget struct {
	Kind       string         `yaml:"kind"`
	Title      string         `yaml:"title"`
	DataSource string         `yaml:"data_source,omitempty"`
	Config     map[string]any `yaml:"config,omitempty"`
}

// SeedAIProvider configures an upstream LLM provider.
type SeedAIProvider struct {
	Tenant  string         `yaml:"tenant,omitempty"`
	Name    string         `yaml:"name"`
	Kind    string         `yaml:"kind"`
	BaseURL string         `yaml:"base_url,omitempty"`
	Models  []SeedAIModel  `yaml:"models,omitempty"`
	Meta    map[string]any `yaml:"metadata,omitempty"`
}

// SeedAIModel is a model alias attached to a provider.
type SeedAIModel struct {
	UpstreamID       string `yaml:"upstream_id"`
	Alias            string `yaml:"alias"`
	RateLimitRPM     int32  `yaml:"rate_limit_rpm,omitempty"`
	DailyQuotaTokens int64  `yaml:"daily_quota_tokens,omitempty"`
}

// SeedAIAgent is a configured persona/role bound to a provider+model.
type SeedAIAgent struct {
	Tenant       string         `yaml:"tenant,omitempty"`
	Provider     string         `yaml:"provider,omitempty"` // resolved to id by name
	Name         string         `yaml:"name"`
	Description  string         `yaml:"description,omitempty"`
	Model        string         `yaml:"model,omitempty"`
	SystemPrompt string         `yaml:"system_prompt,omitempty"`
	Guardrails   map[string]any `yaml:"guardrails,omitempty"`
}

// SeedAITool is a callable an agent can invoke.
type SeedAITool struct {
	Tenant       string         `yaml:"tenant,omitempty"`
	Name         string         `yaml:"name"`
	Kind         string         `yaml:"kind"`
	Description  string         `yaml:"description,omitempty"`
	Schema       map[string]any `yaml:"schema,omitempty"`
	HTTPEndpoint string         `yaml:"http_endpoint,omitempty"`
	MCPServer    string         `yaml:"mcp_server,omitempty"` // resolved by name
	Dangerous    bool           `yaml:"dangerous,omitempty"`
}

// SeedAIToolBinding wires an agent to a tool.
type SeedAIToolBinding struct {
	Tenant    string `yaml:"tenant,omitempty"`
	Agent     string `yaml:"agent"` // resolved by name
	Tool      string `yaml:"tool"`  // resolved by name
	Condition string `yaml:"condition,omitempty"`
}

// SeedAIRateLimit configures a semantic rate limit.
type SeedAIRateLimit struct {
	Tenant              string   `yaml:"tenant,omitempty"`
	Name                string   `yaml:"name"`
	Scope               string   `yaml:"scope"`
	Agent               string   `yaml:"agent,omitempty"`
	Tool                string   `yaml:"tool,omitempty"`
	Exemplars           []string `yaml:"exemplars,omitempty"`
	SimilarityThreshold float64  `yaml:"similarity_threshold,omitempty"`
	WindowSeconds       int32    `yaml:"window_seconds,omitempty"`
	Threshold           int32    `yaml:"threshold,omitempty"`
	Action              string   `yaml:"action,omitempty"`
}

// SeedMCPServer registers a remote MCP endpoint.
type SeedMCPServer struct {
	Tenant         string `yaml:"tenant,omitempty"`
	Name           string `yaml:"name"`
	URL            string `yaml:"url"`
	AuthKind       string `yaml:"auth_kind,omitempty"`
	AuthCredential string `yaml:"auth_credential,omitempty"`
}

// SeedNotifChannel registers an outbound notification destination.
type SeedNotifChannel struct {
	Tenant string         `yaml:"tenant,omitempty"`
	Name   string         `yaml:"name"`
	Kind   string         `yaml:"kind"`
	Config map[string]any `yaml:"config,omitempty"`
}

// SeedNotifRoutingRule maps event filters to channels.
type SeedNotifRoutingRule struct {
	Tenant      string         `yaml:"tenant,omitempty"`
	Name        string         `yaml:"name"`
	EventFilter map[string]any `yaml:"event_filter,omitempty"`
	Channels    []string       `yaml:"channels,omitempty"` // channel names
	OrderHint   int32          `yaml:"order_hint,omitempty"`
}

// SeedPlugin installs a plugin (tenant-scoped). For global plugins,
// leave Tenant empty AND set Global=true.
type SeedPlugin struct {
	Tenant  string `yaml:"tenant,omitempty"`
	Global  bool   `yaml:"global,omitempty"`
	Slug    string `yaml:"slug"`
	Name    string `yaml:"name"`
	Version string `yaml:"version"`
}

// SeedPluginSigner registers a trust anchor for plugin signatures.
type SeedPluginSigner struct {
	Tenant      string `yaml:"tenant,omitempty"`
	Global      bool   `yaml:"global,omitempty"`
	Name        string `yaml:"name"`
	Fingerprint string `yaml:"fingerprint"`
	Notes       string `yaml:"notes,omitempty"`
}

// SeedCertAuthority registers a per-tenant CA.
type SeedCertAuthority struct {
	Tenant         string `yaml:"tenant,omitempty"`
	Name           string `yaml:"name"`
	Kind           string `yaml:"kind"`
	Subject        string `yaml:"subject"`
	CertificatePEM string `yaml:"certificate_pem,omitempty"`
}

// SeedCertEnrollment requests a certificate through a CA.
type SeedCertEnrollment struct {
	Tenant  string   `yaml:"tenant,omitempty"`
	CA      string   `yaml:"ca,omitempty"` // CA name; resolved to id
	Subject string   `yaml:"subject"`
	DNSSANs []string `yaml:"dns_sans,omitempty"`
}

// SeedTLSCertificate is a TLS cert managed by the daemon.
type SeedTLSCertificate struct {
	Tenant         string `yaml:"tenant,omitempty"`
	Domain         string `yaml:"domain"`
	Issuer         string `yaml:"issuer,omitempty"`
	Source         string `yaml:"source,omitempty"`
	CertificatePEM string `yaml:"certificate_pem,omitempty"`
}

// SeedTLSConfig is the singleton TLS config for the default tenant.
type SeedTLSConfig struct {
	Tenant         string   `yaml:"tenant,omitempty"`
	ACMEProvider   string   `yaml:"acme_provider,omitempty"`
	ACMEEmail      string   `yaml:"acme_email,omitempty"`
	ACMEDirectory  string   `yaml:"acme_directory,omitempty"`
	AllowedCiphers []string `yaml:"allowed_ciphers,omitempty"`
	MinProtocol    string   `yaml:"min_protocol,omitempty"`
}

// SeedNetworkConfig is the singleton network config.
type SeedNetworkConfig struct {
	Tenant              string   `yaml:"tenant,omitempty"`
	ListenAddresses     []string `yaml:"listen_addresses,omitempty"`
	HTTP3Enabled        bool     `yaml:"http3_enabled,omitempty"`
	ReadTimeoutSeconds  int32    `yaml:"read_timeout_seconds,omitempty"`
	WriteTimeoutSeconds int32    `yaml:"write_timeout_seconds,omitempty"`
	IdleTimeoutSeconds  int32    `yaml:"idle_timeout_seconds,omitempty"`
}

// SeedAuthPolicy is the singleton tenant auth policy.
type SeedAuthPolicy struct {
	Tenant            string `yaml:"tenant,omitempty"`
	TOTPPolicy        string `yaml:"totp_policy,omitempty"`
	MinLength         int32  `yaml:"min_length,omitempty"`
	RequireUppercase  bool   `yaml:"require_uppercase,omitempty"`
	RequireLowercase  bool   `yaml:"require_lowercase,omitempty"`
	RequireDigit      bool   `yaml:"require_digit,omitempty"`
	RequireSymbol     bool   `yaml:"require_symbol,omitempty"`
	IdleHours         int32  `yaml:"idle_hours,omitempty"`
	AbsoluteHours     int32  `yaml:"absolute_hours,omitempty"`
	MaxFailedAttempts int32  `yaml:"max_failed_attempts,omitempty"`
	LockoutMinutes    int32  `yaml:"lockout_minutes,omitempty"`
}

// SeedObservabilityConfig is the singleton observability config.
type SeedObservabilityConfig struct {
	Tenant                string         `yaml:"tenant,omitempty"`
	MetricsScrapeEndpoint string         `yaml:"metrics_scrape_endpoint,omitempty"`
	MetricsScrapeAuth     map[string]any `yaml:"metrics_scrape_auth,omitempty"`
	MetricsRetentionDays  int32          `yaml:"metrics_retention_days,omitempty"`
	LogLevels             map[string]any `yaml:"log_levels,omitempty"`
	LogFormat             string         `yaml:"log_format,omitempty"`
	LogRotation           map[string]any `yaml:"log_rotation,omitempty"`
	TracesRetentionDays   int32          `yaml:"traces_retention_days,omitempty"`
	TracesSampleRate      float64        `yaml:"traces_sample_rate,omitempty"`
}

// SeedAuditRetentionConfig is the singleton audit retention policy.
type SeedAuditRetentionConfig struct {
	Tenant                   string `yaml:"tenant,omitempty"`
	RetentionDaysRead        int32  `yaml:"retention_days_read,omitempty"`
	RetentionDaysWrite       int32  `yaml:"retention_days_write,omitempty"`
	RetentionDaysDestructive int32  `yaml:"retention_days_destructive,omitempty"`
	AutoExport               string `yaml:"auto_export,omitempty"`
	AutoExportFormat         string `yaml:"auto_export_format,omitempty"`
	AutoExportDestination    string `yaml:"auto_export_destination,omitempty"`
}

// SeedNotificationConfig is the singleton tenant notification config.
type SeedNotificationConfig struct {
	Tenant              string   `yaml:"tenant,omitempty"`
	Enabled             bool     `yaml:"enabled,omitempty"`
	OptInMode           string   `yaml:"opt_in_mode,omitempty"`
	MaxRetries          int32    `yaml:"max_retries,omitempty"`
	RetryBackoffSeconds int32    `yaml:"retry_backoff_seconds,omitempty"`
	ChannelPriority     []string `yaml:"channel_priority,omitempty"`
}

// SeedWebhookEndpoint is a per-tenant outbound infra webhook.
type SeedWebhookEndpoint struct {
	Tenant string   `yaml:"tenant,omitempty"`
	Name   string   `yaml:"name"`
	URL    string   `yaml:"url"`
	Secret string   `yaml:"secret,omitempty"`
	Events []string `yaml:"events,omitempty"`
}

// ---------------------------------------------------------------------------
// Command constructor
// ---------------------------------------------------------------------------

func newSeedCmd() *cobra.Command {
	var (
		seedFile   string
		seedDir    string
		targetAddr string
		username   string
		password   string
		direct     bool
	)

	cmd := &cobra.Command{
		Use:   "seed",
		Short: "Apply seed data from a YAML file or directory to a running Rioku instance",
		Long: `Reads a YAML seed file (or a directory of seed files) and applies services,
routes, policies, users, roles, and API keys to a running Rioku daemon via its REST API.

When --dir is used, all *.yaml and *.yml files in the directory are loaded in
alphabetical order, env-substituted, and merged: slice fields are appended and
pointer/singleton fields are last-write-wins.

Both --file and --dir support environment variable substitution using ${VAR:-default} syntax.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			if (seedFile == "" && seedDir == "") || (seedFile != "" && seedDir != "") {
				return fmt.Errorf("exactly one of --file or --dir is required")
			}
			return runSeed(seedFile, seedDir, targetAddr, username, password, direct)
		},
	}

	cmd.Flags().StringVarP(&seedFile, "file", "f", "", "path to seed YAML file (mutually exclusive with --dir)")
	cmd.Flags().StringVarP(&seedDir, "dir", "d", "", "path to a directory of seed YAML files (mutually exclusive with --file)")
	cmd.Flags().StringVar(&targetAddr, "target", "http://localhost:7778", "daemon REST API address")
	cmd.Flags().StringVarP(&username, "username", "u", "root", "admin username for API authentication")
	cmd.Flags().StringVarP(&password, "password", "p", "", "admin password (or set SANDBOX_ROOT_PASSWORD env)")
	cmd.Flags().BoolVar(&direct, "direct", false, "write directly to store, bypassing API (not implemented)")

	return cmd
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

func runSeed(seedFile, seedDir, targetAddr, username, password string, direct bool) error {
	logger := slog.Default().With("component", "seed")

	if direct {
		return fmt.Errorf("--direct mode is not implemented yet")
	}

	var seed SeedFile
	if seedFile != "" {
		// Read and env-substitute the seed file.
		raw, err := os.ReadFile(seedFile)
		if err != nil {
			return fmt.Errorf("read seed file: %w", err)
		}
		raw = envSubstitute(raw)
		if err := yaml.Unmarshal(raw, &seed); err != nil {
			return fmt.Errorf("parse seed file: %w", err)
		}
	} else {
		merged, err := loadSeedFromDir(seedDir)
		if err != nil {
			return fmt.Errorf("load seed dir: %w", err)
		}
		seed = merged
	}

	// Resolve password.
	if password == "" {
		password = os.Getenv("SANDBOX_ROOT_PASSWORD")
	}
	if password == "" {
		return fmt.Errorf("password required: use --password flag or set SANDBOX_ROOT_PASSWORD env")
	}

	// Build HTTP client — we'll manage cookies manually to avoid jar issues.
	client := &http.Client{}
	base := strings.TrimRight(targetAddr, "/")

	// Login.
	logger.Info("logging in", "username", username, "target", base)
	loginBody, _ := json.Marshal(map[string]string{
		"username": username,
		"password": password,
	})
	resp, err := client.Post(base+"/api/v1/auth/login", "application/json", bytes.NewReader(loginBody))
	if err != nil {
		return fmt.Errorf("login request failed: %w", err)
	}
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		return fmt.Errorf("login failed: HTTP %d: %s", resp.StatusCode, string(body))
	}

	// Extract session cookie manually.
	var sessionCookie string
	for _, c := range resp.Cookies() {
		if c.Name == "rioku_sid" {
			sessionCookie = c.Name + "=" + c.Value
			break
		}
	}
	_, _ = io.ReadAll(resp.Body)
	_ = resp.Body.Close()

	if sessionCookie == "" {
		return fmt.Errorf("login succeeded but no rioku_sid cookie in response")
	}
	logger.Info("login successful")

	// Track counts for summary.
	var counts struct {
		roles    int
		services int
		policies int
		routes   int
		users    int
		apiKeys  int
	}

	// --- Roles ---
	for _, role := range seed.Roles {
		payload, _ := json.Marshal(map[string]string{
			"name":        role.Name,
			"description": role.Description,
		})
		status, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/roles", payload)
		if status == http.StatusConflict {
			logger.Info("role already exists", "name", role.Name)
		} else if status >= 200 && status < 300 {
			logger.Info("role created", "name", role.Name)
		} else {
			logger.Warn("role creation returned unexpected status", "name", role.Name, "status", status)
		}
		counts.roles++
	}

	// --- Services ---
	for _, svc := range seed.Services {
		upstreams := make([]map[string]string, len(svc.Upstreams))
		for i, u := range svc.Upstreams {
			upstreams[i] = map[string]string{"address": u.Address}
		}
		change := map[string]any{
			"service": map[string]any{
				"action": "UPSERT",
				"service": map[string]any{
					"name":      svc.Name,
					"upstreams": upstreams,
					"lbPolicy":  svc.LBPolicy,
				},
			},
		}
		payload, _ := json.Marshal(change)
		status, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/config", payload)
		logger.Info("service seeded", "name", svc.Name, "status", status)
		counts.services++
	}

	// --- Policies ---
	for _, pol := range seed.Policies {
		change := map[string]any{
			"policy": map[string]any{
				"action": "UPSERT",
				"policy": map[string]any{
					"name":   pol.Name,
					"type":   pol.Type,
					"config": pol.Config,
				},
			},
		}
		payload, _ := json.Marshal(change)
		status, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/config", payload)
		logger.Info("policy seeded", "name", pol.Name, "status", status)
		counts.policies++
	}

	// --- Fetch service and policy IDs for route references ---
	serviceIDs, policyIDs, err := fetchConfigIDs(client, sessionCookie, base)
	if err != nil {
		logger.Warn("could not fetch config IDs for route resolution", "error", err)
	}

	// --- Routes ---
	for _, route := range seed.Routes {
		svcID, ok := serviceIDs[route.Service]
		if !ok {
			logger.Warn("route skipped: service not found", "route", route.Name, "service", route.Service)
			continue
		}

		polIDs := make([]string, 0, len(route.Policies))
		for _, pName := range route.Policies {
			if pid, found := policyIDs[pName]; found {
				polIDs = append(polIDs, pid)
			} else {
				logger.Warn("route policy not found", "route", route.Name, "policy", pName)
			}
		}

		enabled := true
		if route.Enabled != nil {
			enabled = *route.Enabled
		}

		// Build matchers in the format the REST API expects.
		matchers := make([]map[string]any, len(route.Matchers))
		for i, m := range route.Matchers {
			matcher := map[string]any{}
			if len(m.Hosts) > 0 {
				matcher["hosts"] = m.Hosts
			}
			if len(m.Paths) > 0 {
				paths := make([]map[string]string, len(m.Paths))
				for j, p := range m.Paths {
					paths[j] = map[string]string{"type": p.Type, "value": p.Value}
				}
				matcher["paths"] = paths
			}
			if len(m.Methods) > 0 {
				matcher["methods"] = m.Methods
			}
			matchers[i] = matcher
		}

		routePayload := map[string]any{
			"name":      route.Name,
			"enabled":   enabled,
			"matchers":  matchers,
			"serviceId": svcID,
			"policyIds": polIDs,
		}

		change := map[string]any{
			"route": map[string]any{
				"action": "UPSERT",
				"route":  routePayload,
			},
		}
		payload, _ := json.Marshal(change)
		status, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/config", payload)
		logger.Info("route seeded", "name", route.Name, "status", status, "policies", len(polIDs))
		counts.routes++
	}

	// --- Users ---
	for _, user := range seed.Users {
		status := user.Status
		if status == "" {
			status = "active"
		}
		userPayload := map[string]any{
			"username":            user.Username,
			"password":            user.Password,
			"status":              status,
			"forcePasswordChange": false,
		}
		payload, _ := json.Marshal(userPayload)
		httpStatus, respBody := apiCall(client, sessionCookie, "POST", base+"/api/v1/users", payload)

		if httpStatus == http.StatusConflict {
			logger.Info("user already exists", "username", user.Username)
		} else if httpStatus >= 200 && httpStatus < 300 {
			logger.Info("user created", "username", user.Username)

			// Extract user ID and assign roles.
			var userResp map[string]any
			if err := json.Unmarshal(respBody, &userResp); err == nil {
				uid := extractUserID(userResp)
				if uid != "" {
					assignUserRoles(client, sessionCookie, base, uid, user.Roles, logger)

					// Handle locked/suspended status.
					switch status {
					case "locked":
						s, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/users/"+uid+"/lock", []byte("{}"))
						logger.Info("user locked", "username", user.Username, "status", s)
					case "suspended":
						s, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/users/"+uid+"/suspend", []byte("{}"))
						logger.Info("user suspended", "username", user.Username, "status", s)
					}
				}
			}
		} else {
			logger.Warn("user creation failed", "username", user.Username, "status", httpStatus)
		}
		counts.users++
	}

	// --- API Keys ---
	for _, key := range seed.APIKeys {
		keyPayload := map[string]any{
			"name":   key.Name,
			"scopes": strings.Join(key.Scopes, ","),
		}
		payload, _ := json.Marshal(keyPayload)
		httpStatus, respBody := apiCall(client, sessionCookie, "POST", base+"/api/v1/keys", payload)
		if httpStatus == http.StatusConflict {
			logger.Info("API key already exists", "name", key.Name)
		} else if httpStatus >= 200 && httpStatus < 300 {
			var keyResp map[string]any
			if err := json.Unmarshal(respBody, &keyResp); err == nil {
				if rawKey, ok := keyResp["key"].(string); ok {
					logger.Info("API key created", "name", key.Name, "key", rawKey)
				} else {
					logger.Info("API key created", "name", key.Name)
				}
			}
		} else {
			logger.Warn("API key creation failed", "name", key.Name, "status", httpStatus)
		}
		counts.apiKeys++
	}

	// --- Stage-2 entities ---
	stage2Counts := applyStage2(client, sessionCookie, base, &seed, logger)

	// Logout.
	_, _ = apiCall(client, sessionCookie, "POST", base+"/api/v1/auth/logout", nil)
	logger.Info("session closed")

	fmt.Printf("Seeded: %d roles, %d services, %d policies, %d routes, %d users, %d API keys\n",
		counts.roles, counts.services, counts.policies, counts.routes, counts.users, counts.apiKeys)
	fmt.Printf("Stage-2: %d tenants, %d memberships, %d sites, %d middlewares, %d dashboards\n",
		stage2Counts.tenants, stage2Counts.memberships, stage2Counts.sites, stage2Counts.middlewares, stage2Counts.dashboards)
	fmt.Printf("AI:      %d providers, %d agents, %d tools, %d bindings, %d rate limits, %d MCP servers\n",
		stage2Counts.aiProviders, stage2Counts.aiAgents, stage2Counts.aiTools, stage2Counts.aiBindings, stage2Counts.aiRateLimits, stage2Counts.mcpServers)
	fmt.Printf("Other:   %d notif channels, %d notif rules, %d plugins, %d signers, %d CAs, %d enrollments, %d TLS certs, %d webhooks\n",
		stage2Counts.notifChannels, stage2Counts.notifRules, stage2Counts.plugins, stage2Counts.pluginSigners,
		stage2Counts.cas, stage2Counts.enrollments, stage2Counts.tlsCerts, stage2Counts.webhooks)
	fmt.Printf("Singletons: %s\n", stage2Counts.singletonsApplied)

	return nil
}

// ---------------------------------------------------------------------------
// Stage-2 entity application
// ---------------------------------------------------------------------------

type stage2Counts struct {
	tenants, memberships, sites, middlewares, dashboards int
	aiProviders, aiAgents, aiTools, aiBindings           int
	aiRateLimits, mcpServers                             int
	notifChannels, notifRules                            int
	plugins, pluginSigners                               int
	cas, enrollments, tlsCerts, webhooks                 int
	singletonsApplied                                    string
}

// applyStage2 walks the tenant-scoped entity blocks and POSTs them
// against /api/v1/t/{tenant}/... routes. Per-entity Tenant defaults
// to "default" when unset.
func applyStage2(client *http.Client, sessionCookie, base string, seed *SeedFile, logger *slog.Logger) stage2Counts {
	c := stage2Counts{}

	tenantOf := func(v string) string {
		if v == "" {
			return "default"
		}
		return v
	}
	tenantBase := func(v string) string { return base + "/api/v1/t/" + tenantOf(v) }

	// 1. Tenants (must come first — everything else may reference them)
	for _, tn := range seed.Tenants {
		payload, _ := json.Marshal(map[string]any{
			"slug": tn.Slug, "name": tn.Name, "plan": tn.Plan, "urlMode": tn.URLMode, "parentDomain": tn.ParentDomain,
		})
		status, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/admin/tenants", payload)
		logSeed(logger, "tenant", tn.Slug, status)
		c.tenants++
	}

	// 2. Memberships — resolve username → user ID + role names → role IDs
	if len(seed.Memberships) > 0 {
		users := fetchNamedItems(client, sessionCookie, base+"/api/v1/users", "username")
		roles := fetchNamedItems(client, sessionCookie, base+"/api/v1/roles", "name")
		for _, m := range seed.Memberships {
			userID, ok := users[m.Username]
			if !ok {
				logger.Warn("membership skipped: user not found", "username", m.Username)
				continue
			}
			state := m.State
			if state == "" {
				state = "active"
			}
			payload, _ := json.Marshal(map[string]any{"userId": userID, "state": state})
			status, body := apiCall(client, sessionCookie, "POST", tenantBase(m.Tenant)+"/memberships", payload)
			logSeed(logger, "membership", m.Username, status)
			c.memberships++
			if status >= 200 && status < 300 && len(m.Roles) > 0 {
				var resp map[string]any
				_ = json.Unmarshal(body, &resp)
				if mid, ok := resp["id"].(string); ok {
					roleIDs := make([]string, 0, len(m.Roles))
					for _, rn := range m.Roles {
						if rid, ok := roles[rn]; ok {
							roleIDs = append(roleIDs, rid)
						}
					}
					rPayload, _ := json.Marshal(map[string]any{"roleIds": roleIDs})
					_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(m.Tenant)+"/memberships/"+mid+"/roles", rPayload)
				}
			}
		}
	}

	// 3. Sites
	for _, s := range seed.Sites {
		payload, _ := json.Marshal(map[string]any{
			"name": s.Name, "domain": s.Domain, "tlsMode": s.TLSMode,
			"upstreamServiceId": s.UpstreamServiceID,
			"basicAuthEnabled":  s.BasicAuthEnabled, "basicAuthRealm": s.BasicAuthRealm,
			"rateLimitPreset": s.RateLimitPreset,
		})
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(s.Tenant)+"/sites", payload)
		logSeed(logger, "site", s.Name, status)
		c.sites++
	}

	// 4. Middlewares
	for _, m := range seed.Middlewares {
		payload, _ := json.Marshal(map[string]any{
			"name": m.Name, "kind": m.Kind, "config": m.Config, "orderHint": m.OrderHint,
		})
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(m.Tenant)+"/middlewares", payload)
		logSeed(logger, "middleware", m.Name, status)
		c.middlewares++
	}

	// 5. Dashboards (+ widgets)
	for _, d := range seed.Dashboards {
		dPayload, _ := json.Marshal(map[string]any{
			"name": d.Name, "description": d.Description, "mode": d.Mode, "scope": d.Scope,
		})
		status, body := apiCall(client, sessionCookie, "POST", tenantBase(d.Tenant)+"/dashboards", dPayload)
		logSeed(logger, "dashboard", d.Name, status)
		c.dashboards++
		if status < 200 || status >= 300 {
			continue
		}
		var resp map[string]any
		_ = json.Unmarshal(body, &resp)
		dashID, _ := resp["id"].(string)
		for _, wg := range d.Widgets {
			wPayload, _ := json.Marshal(map[string]any{
				"kind": wg.Kind, "title": wg.Title, "dataSource": wg.DataSource, "config": wg.Config,
			})
			_, _ = apiCall(client, sessionCookie, "POST", tenantBase(d.Tenant)+"/dashboards/"+dashID+"/widgets", wPayload)
		}
	}

	// 6. AI providers (+ models)
	providerIDs := make(map[string]string)
	for _, p := range seed.AIProviders {
		payload, _ := json.Marshal(map[string]any{
			"name": p.Name, "kind": p.Kind, "baseUrl": p.BaseURL, "metadata": p.Meta,
		})
		status, body := apiCall(client, sessionCookie, "POST", tenantBase(p.Tenant)+"/ai/providers", payload)
		logSeed(logger, "ai-provider", p.Name, status)
		c.aiProviders++
		if status < 200 || status >= 300 {
			continue
		}
		var resp map[string]any
		_ = json.Unmarshal(body, &resp)
		pid, _ := resp["id"].(string)
		providerIDs[p.Name] = pid
		for _, m := range p.Models {
			mPayload, _ := json.Marshal(map[string]any{
				"upstreamModelId": m.UpstreamID, "alias": m.Alias,
				"rateLimitRpm": m.RateLimitRPM, "dailyQuotaTokens": m.DailyQuotaTokens,
			})
			_, _ = apiCall(client, sessionCookie, "POST", tenantBase(p.Tenant)+"/ai/providers/"+pid+"/models", mPayload)
		}
	}

	// 7. MCP servers (must come before AI tools that reference them)
	mcpIDs := make(map[string]string)
	for _, s := range seed.MCPServers {
		payload, _ := json.Marshal(map[string]any{
			"name": s.Name, "url": s.URL, "authKind": s.AuthKind, "authCredential": s.AuthCredential,
		})
		status, body := apiCall(client, sessionCookie, "POST", tenantBase(s.Tenant)+"/ai/mcp-servers", payload)
		logSeed(logger, "mcp-server", s.Name, status)
		c.mcpServers++
		if status >= 200 && status < 300 {
			var resp map[string]any
			_ = json.Unmarshal(body, &resp)
			if id, ok := resp["id"].(string); ok {
				mcpIDs[s.Name] = id
			}
		}
	}

	// 8. AI tools
	toolIDs := make(map[string]string)
	for _, t := range seed.AITools {
		payload := map[string]any{
			"name": t.Name, "kind": t.Kind, "description": t.Description, "schema": t.Schema,
			"dangerous": t.Dangerous,
		}
		if t.HTTPEndpoint != "" {
			payload["httpEndpoint"] = t.HTTPEndpoint
		}
		if t.MCPServer != "" {
			if id, ok := mcpIDs[t.MCPServer]; ok {
				payload["mcpServerId"] = id
			}
		}
		body, _ := json.Marshal(payload)
		status, respBody := apiCall(client, sessionCookie, "POST", tenantBase(t.Tenant)+"/ai/tools", body)
		logSeed(logger, "ai-tool", t.Name, status)
		c.aiTools++
		if status >= 200 && status < 300 {
			var resp map[string]any
			_ = json.Unmarshal(respBody, &resp)
			if id, ok := resp["id"].(string); ok {
				toolIDs[t.Name] = id
			}
		}
	}

	// 9. AI agents
	agentIDs := make(map[string]string)
	for _, a := range seed.AIAgents {
		payload := map[string]any{
			"name": a.Name, "description": a.Description, "model": a.Model,
			"systemPrompt": a.SystemPrompt, "guardrails": a.Guardrails,
		}
		if a.Provider != "" {
			if pid, ok := providerIDs[a.Provider]; ok {
				payload["providerId"] = pid
			}
		}
		body, _ := json.Marshal(payload)
		status, respBody := apiCall(client, sessionCookie, "POST", tenantBase(a.Tenant)+"/ai/agents", body)
		logSeed(logger, "ai-agent", a.Name, status)
		c.aiAgents++
		if status >= 200 && status < 300 {
			var resp map[string]any
			_ = json.Unmarshal(respBody, &resp)
			if id, ok := resp["id"].(string); ok {
				agentIDs[a.Name] = id
			}
		}
	}

	// 10. AI tool bindings
	for _, b := range seed.AIToolBindings {
		aid, aOK := agentIDs[b.Agent]
		tid, tOK := toolIDs[b.Tool]
		if !aOK || !tOK {
			logger.Warn("ai-binding skipped: missing agent or tool", "agent", b.Agent, "tool", b.Tool)
			continue
		}
		payload, _ := json.Marshal(map[string]any{
			"agentId": aid, "toolId": tid, "condition": b.Condition,
		})
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(b.Tenant)+"/ai/tool-bindings", payload)
		logSeed(logger, "ai-binding", b.Agent+"->"+b.Tool, status)
		c.aiBindings++
	}

	// 11. AI rate limits
	for _, rl := range seed.AIRateLimits {
		payload := map[string]any{
			"name": rl.Name, "scope": rl.Scope, "exemplars": rl.Exemplars,
			"similarityThreshold": rl.SimilarityThreshold, "windowSeconds": rl.WindowSeconds,
			"threshold": rl.Threshold, "action": rl.Action,
		}
		if rl.Agent != "" {
			if aid, ok := agentIDs[rl.Agent]; ok {
				payload["agentId"] = aid
			}
		}
		if rl.Tool != "" {
			if tid, ok := toolIDs[rl.Tool]; ok {
				payload["toolId"] = tid
			}
		}
		body, _ := json.Marshal(payload)
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(rl.Tenant)+"/ai/rate-limits", body)
		logSeed(logger, "ai-rate-limit", rl.Name, status)
		c.aiRateLimits++
	}

	// 12. Notification channels
	channelIDs := make(map[string]string)
	for _, ch := range seed.NotificationChannels {
		body, _ := json.Marshal(map[string]any{
			"name": ch.Name, "kind": ch.Kind, "config": ch.Config,
		})
		status, respBody := apiCall(client, sessionCookie, "POST", tenantBase(ch.Tenant)+"/notification-channels", body)
		logSeed(logger, "notif-channel", ch.Name, status)
		c.notifChannels++
		if status >= 200 && status < 300 {
			var resp map[string]any
			_ = json.Unmarshal(respBody, &resp)
			if id, ok := resp["id"].(string); ok {
				channelIDs[ch.Name] = id
			}
		}
	}

	// 13. Notification routing rules
	for _, rule := range seed.NotificationRouting {
		chIDs := make([]string, 0, len(rule.Channels))
		for _, name := range rule.Channels {
			if id, ok := channelIDs[name]; ok {
				chIDs = append(chIDs, id)
			}
		}
		body, _ := json.Marshal(map[string]any{
			"name": rule.Name, "eventFilter": rule.EventFilter,
			"channelIds": chIDs, "orderHint": rule.OrderHint,
		})
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(rule.Tenant)+"/notification-routing", body)
		logSeed(logger, "notif-rule", rule.Name, status)
		c.notifRules++
	}

	// 14. Plugin signers (must come before plugins so signer_id can resolve)
	for _, s := range seed.PluginSigners {
		body, _ := json.Marshal(map[string]any{
			"name": s.Name, "fingerprint": s.Fingerprint, "notes": s.Notes,
		})
		path := tenantBase(s.Tenant) + "/plugin-signers"
		if s.Global {
			path = base + "/api/v1/admin/plugin-signers"
		}
		status, _ := apiCall(client, sessionCookie, "POST", path, body)
		logSeed(logger, "plugin-signer", s.Name, status)
		c.pluginSigners++
	}

	// 15. Plugins
	for _, p := range seed.Plugins {
		body, _ := json.Marshal(map[string]any{
			"slug": p.Slug, "name": p.Name, "version": p.Version,
		})
		path := tenantBase(p.Tenant) + "/plugins/install"
		status, _ := apiCall(client, sessionCookie, "POST", path, body)
		logSeed(logger, "plugin", p.Slug, status)
		c.plugins++
	}

	// 16. Cert authorities
	caIDs := make(map[string]string)
	for _, ca := range seed.CertAuthorities {
		body, _ := json.Marshal(map[string]any{
			"name": ca.Name, "kind": ca.Kind, "subject": ca.Subject,
			"certificatePem": ca.CertificatePEM,
		})
		status, respBody := apiCall(client, sessionCookie, "POST", tenantBase(ca.Tenant)+"/settings/pki/cas", body)
		logSeed(logger, "cert-authority", ca.Name, status)
		c.cas++
		if status >= 200 && status < 300 {
			var resp map[string]any
			_ = json.Unmarshal(respBody, &resp)
			if id, ok := resp["id"].(string); ok {
				caIDs[ca.Name] = id
			}
		}
	}

	// 17. Cert enrollments
	for _, e := range seed.CertEnrollments {
		payload := map[string]any{
			"subject": e.Subject, "dnsSans": e.DNSSANs,
		}
		if e.CA != "" {
			if id, ok := caIDs[e.CA]; ok {
				payload["caId"] = id
			}
		}
		body, _ := json.Marshal(payload)
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(e.Tenant)+"/settings/pki/enrollments", body)
		logSeed(logger, "cert-enrollment", e.Subject, status)
		c.enrollments++
	}

	// 18. TLS certificates
	for _, t := range seed.TLSCertificates {
		body, _ := json.Marshal(map[string]any{
			"domain": t.Domain, "issuer": t.Issuer, "source": t.Source,
			"certificatePem": t.CertificatePEM,
		})
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(t.Tenant)+"/settings/tls/certificates", body)
		logSeed(logger, "tls-cert", t.Domain, status)
		c.tlsCerts++
	}

	// 19. Singleton settings configs (PUTs, no count beyond yes/no)
	var applied []string
	if seed.TLSConfig != nil {
		body, _ := json.Marshal(map[string]any{
			"provider": seed.TLSConfig.ACMEProvider, "email": seed.TLSConfig.ACMEEmail,
			"directory": seed.TLSConfig.ACMEDirectory,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(seed.TLSConfig.Tenant)+"/settings/tls/config/acme", body)
		body2, _ := json.Marshal(map[string]any{
			"allowedCiphers": seed.TLSConfig.AllowedCiphers, "minProtocol": seed.TLSConfig.MinProtocol,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(seed.TLSConfig.Tenant)+"/settings/tls/config/ciphers", body2)
		applied = append(applied, "tls")
	}
	if seed.NetworkConfig != nil {
		body, _ := json.Marshal(map[string]any{
			"listenAddresses": seed.NetworkConfig.ListenAddresses, "http3Enabled": seed.NetworkConfig.HTTP3Enabled,
			"readTimeoutSeconds":  seed.NetworkConfig.ReadTimeoutSeconds,
			"writeTimeoutSeconds": seed.NetworkConfig.WriteTimeoutSeconds,
			"idleTimeoutSeconds":  seed.NetworkConfig.IdleTimeoutSeconds,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(seed.NetworkConfig.Tenant)+"/settings/network", body)
		applied = append(applied, "network")
	}
	if seed.AuthPolicy != nil {
		body, _ := json.Marshal(map[string]any{
			"totpPolicy": seed.AuthPolicy.TOTPPolicy, "minLength": seed.AuthPolicy.MinLength,
			"requireUppercase": seed.AuthPolicy.RequireUppercase, "requireLowercase": seed.AuthPolicy.RequireLowercase,
			"requireDigit": seed.AuthPolicy.RequireDigit, "requireSymbol": seed.AuthPolicy.RequireSymbol,
			"idleHours": seed.AuthPolicy.IdleHours, "absoluteHours": seed.AuthPolicy.AbsoluteHours,
			"maxFailedAttempts": seed.AuthPolicy.MaxFailedAttempts, "lockoutMinutes": seed.AuthPolicy.LockoutMinutes,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(seed.AuthPolicy.Tenant)+"/settings/auth-policy", body)
		applied = append(applied, "auth-policy")
	}
	if seed.ObservabilityConfig != nil {
		o := seed.ObservabilityConfig
		body, _ := json.Marshal(map[string]any{
			"scrapeEndpoint": o.MetricsScrapeEndpoint, "scrapeAuth": o.MetricsScrapeAuth,
			"retentionDays": o.MetricsRetentionDays,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(o.Tenant)+"/settings/observability/metrics", body)
		body2, _ := json.Marshal(map[string]any{
			"levels": o.LogLevels, "format": o.LogFormat, "rotation": o.LogRotation,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(o.Tenant)+"/settings/observability/logs", body2)
		body3, _ := json.Marshal(map[string]any{
			"retentionDays": o.TracesRetentionDays, "sampleRate": o.TracesSampleRate,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(o.Tenant)+"/settings/observability/traces", body3)
		applied = append(applied, "observability")
	}
	if seed.AuditRetentionConfig != nil {
		a := seed.AuditRetentionConfig
		body, _ := json.Marshal(map[string]any{
			"retentionDaysRead": a.RetentionDaysRead, "retentionDaysWrite": a.RetentionDaysWrite,
			"retentionDaysDestructive": a.RetentionDaysDestructive,
			"autoExport":               a.AutoExport, "autoExportFormat": a.AutoExportFormat,
			"autoExportDestination": a.AutoExportDestination,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(a.Tenant)+"/audit/retention", body)
		applied = append(applied, "audit-retention")
	}
	if seed.NotificationConfig != nil {
		n := seed.NotificationConfig
		body, _ := json.Marshal(map[string]any{
			"enabled": n.Enabled, "optInMode": n.OptInMode,
			"maxRetries": n.MaxRetries, "retryBackoffSeconds": n.RetryBackoffSeconds,
			"channelPriority": n.ChannelPriority,
		})
		_, _ = apiCall(client, sessionCookie, "PUT", tenantBase(n.Tenant)+"/settings/notifications", body)
		applied = append(applied, "notifications")
	}
	c.singletonsApplied = strings.Join(applied, ", ")
	if c.singletonsApplied == "" {
		c.singletonsApplied = "none"
	}

	// 20. Webhook endpoints
	for _, w := range seed.WebhookEndpoints {
		var secretPtr *string
		if w.Secret != "" {
			secretPtr = &w.Secret
		}
		body, _ := json.Marshal(map[string]any{
			"name": w.Name, "url": w.URL, "secret": secretPtr, "events": w.Events,
		})
		status, _ := apiCall(client, sessionCookie, "POST", tenantBase(w.Tenant)+"/settings/webhooks", body)
		logSeed(logger, "webhook", w.Name, status)
		c.webhooks++
	}

	return c
}

// loadSeedFromDir walks dir, reads every *.yaml/*.yml file in alphabetical
// order, env-substitutes each, decodes each into SeedFile, and merges the
// results: slice fields are appended (later files extend), pointer fields
// are last-write-wins (later files override).
func loadSeedFromDir(dir string) (SeedFile, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return SeedFile{}, err
	}
	var paths []string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		n := e.Name()
		if strings.HasSuffix(n, ".yaml") || strings.HasSuffix(n, ".yml") {
			paths = append(paths, filepath.Join(dir, n))
		}
	}
	sort.Strings(paths)
	var merged SeedFile
	for _, p := range paths {
		raw, err := os.ReadFile(p)
		if err != nil {
			return SeedFile{}, fmt.Errorf("read %s: %w", p, err)
		}
		raw = envSubstitute(raw)
		var part SeedFile
		if err := yaml.Unmarshal(raw, &part); err != nil {
			return SeedFile{}, fmt.Errorf("parse %s: %w", p, err)
		}
		mergeSeed(&merged, &part)
	}
	return merged, nil
}

// mergeSeed appends slice fields and overwrites pointer fields with
// last-write-wins semantics. Order in the directory listing is the
// tiebreaker for pointer-field conflicts.
func mergeSeed(dst, src *SeedFile) {
	dst.Roles = append(dst.Roles, src.Roles...)
	dst.Services = append(dst.Services, src.Services...)
	dst.Policies = append(dst.Policies, src.Policies...)
	dst.Routes = append(dst.Routes, src.Routes...)
	dst.Users = append(dst.Users, src.Users...)
	dst.APIKeys = append(dst.APIKeys, src.APIKeys...)
	dst.Tenants = append(dst.Tenants, src.Tenants...)
	dst.Memberships = append(dst.Memberships, src.Memberships...)
	dst.Sites = append(dst.Sites, src.Sites...)
	dst.Middlewares = append(dst.Middlewares, src.Middlewares...)
	dst.Dashboards = append(dst.Dashboards, src.Dashboards...)
	dst.AIProviders = append(dst.AIProviders, src.AIProviders...)
	dst.AIAgents = append(dst.AIAgents, src.AIAgents...)
	dst.AITools = append(dst.AITools, src.AITools...)
	dst.AIToolBindings = append(dst.AIToolBindings, src.AIToolBindings...)
	dst.AIRateLimits = append(dst.AIRateLimits, src.AIRateLimits...)
	dst.MCPServers = append(dst.MCPServers, src.MCPServers...)
	dst.NotificationChannels = append(dst.NotificationChannels, src.NotificationChannels...)
	dst.NotificationRouting = append(dst.NotificationRouting, src.NotificationRouting...)
	dst.Plugins = append(dst.Plugins, src.Plugins...)
	dst.PluginSigners = append(dst.PluginSigners, src.PluginSigners...)
	dst.CertAuthorities = append(dst.CertAuthorities, src.CertAuthorities...)
	dst.CertEnrollments = append(dst.CertEnrollments, src.CertEnrollments...)
	dst.TLSCertificates = append(dst.TLSCertificates, src.TLSCertificates...)
	dst.WebhookEndpoints = append(dst.WebhookEndpoints, src.WebhookEndpoints...)
	// Pointer/singleton fields: last-write-wins.
	if src.TLSConfig != nil {
		dst.TLSConfig = src.TLSConfig
	}
	if src.NetworkConfig != nil {
		dst.NetworkConfig = src.NetworkConfig
	}
	if src.AuthPolicy != nil {
		dst.AuthPolicy = src.AuthPolicy
	}
	if src.ObservabilityConfig != nil {
		dst.ObservabilityConfig = src.ObservabilityConfig
	}
	if src.AuditRetentionConfig != nil {
		dst.AuditRetentionConfig = src.AuditRetentionConfig
	}
	if src.NotificationConfig != nil {
		dst.NotificationConfig = src.NotificationConfig
	}
}

// logSeed emits a single info or warn line for a seeded entity.
func logSeed(logger *slog.Logger, kind, name string, status int) {
	switch {
	case status == http.StatusConflict:
		logger.Info(kind+" already exists", "name", name)
	case status >= 200 && status < 300:
		logger.Info(kind+" seeded", "name", name, "status", status)
	default:
		logger.Warn(kind+" seed failed", "name", name, "status", status)
	}
}

// fetchNamedItems fetches a list endpoint and indexes items by the
// supplied "name field" -> id. Tolerates both `[items..]` and
// `{"items": [..], ...}` envelopes.
func fetchNamedItems(client *http.Client, sessionCookie, url, nameField string) map[string]string {
	out := make(map[string]string)
	_, body := apiCall(client, sessionCookie, "GET", url, nil)
	// Try envelope shape first.
	var env map[string]any
	if err := json.Unmarshal(body, &env); err == nil {
		if items, ok := env["items"].([]any); ok {
			for _, it := range items {
				if m, ok := it.(map[string]any); ok {
					n, _ := m[nameField].(string)
					id, _ := m["id"].(string)
					if n != "" && id != "" {
						out[n] = id
					}
				}
			}
			return out
		}
		if items, ok := env["users"].([]any); ok {
			for _, it := range items {
				if m, ok := it.(map[string]any); ok {
					n, _ := m[nameField].(string)
					id, _ := m["id"].(string)
					if n != "" && id != "" {
						out[n] = id
					}
				}
			}
			return out
		}
		if items, ok := env["roles"].([]any); ok {
			for _, it := range items {
				if m, ok := it.(map[string]any); ok {
					n, _ := m[nameField].(string)
					id, _ := m["id"].(string)
					if n != "" && id != "" {
						out[n] = id
					}
				}
			}
			return out
		}
	}
	// Try bare array.
	var arr []any
	if err := json.Unmarshal(body, &arr); err == nil {
		for _, it := range arr {
			if m, ok := it.(map[string]any); ok {
				n, _ := m[nameField].(string)
				id, _ := m["id"].(string)
				if n != "" && id != "" {
					out[n] = id
				}
			}
		}
	}
	return out
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// envSubstitute replaces ${VAR:-default} patterns with environment values.
func envSubstitute(data []byte) []byte {
	re := regexp.MustCompile(`\$\{(\w+)(?::-(.*?))?\}`)
	return re.ReplaceAllFunc(data, func(match []byte) []byte {
		groups := re.FindSubmatch(match)
		varName := string(groups[1])
		defaultVal := ""
		if len(groups) > 2 {
			defaultVal = string(groups[2])
		}
		if val := os.Getenv(varName); val != "" {
			return []byte(val)
		}
		return []byte(defaultVal)
	})
}

// apiCall makes an HTTP request with the session cookie and returns status code + body.
func apiCall(client *http.Client, sessionCookie, method, endpoint string, body []byte) (int, []byte) {
	var bodyReader io.Reader
	if body != nil {
		bodyReader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, endpoint, bodyReader)
	if err != nil {
		return 0, nil
	}
	req.Header.Set("Content-Type", "application/json")
	if sessionCookie != "" {
		req.Header.Set("Cookie", sessionCookie)
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, nil
	}
	defer func() { _ = resp.Body.Close() }()
	respBody, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, respBody
}

// fetchConfigIDs retrieves the current config and builds name-to-ID maps for
// services and policies.
func fetchConfigIDs(client *http.Client, sessionCookie, base string) (serviceIDs, policyIDs map[string]string, err error) {
	serviceIDs = make(map[string]string)
	policyIDs = make(map[string]string)

	status, body := apiCall(client, sessionCookie, "GET", base+"/api/v1/config", nil)
	if status != http.StatusOK {
		return serviceIDs, policyIDs, fmt.Errorf("GET /api/v1/config returned HTTP %d", status)
	}

	var cfg map[string]any
	if err := json.Unmarshal(body, &cfg); err != nil {
		return serviceIDs, policyIDs, fmt.Errorf("parse config response: %w", err)
	}

	if services, ok := cfg["services"].([]any); ok {
		for _, s := range services {
			if svc, ok := s.(map[string]any); ok {
				name, _ := svc["name"].(string)
				id, _ := svc["id"].(string)
				if name != "" && id != "" {
					serviceIDs[name] = id
				}
			}
		}
	}

	if policies, ok := cfg["policies"].([]any); ok {
		for _, p := range policies {
			if pol, ok := p.(map[string]any); ok {
				name, _ := pol["name"].(string)
				id, _ := pol["id"].(string)
				if name != "" && id != "" {
					policyIDs[name] = id
				}
			}
		}
	}

	return serviceIDs, policyIDs, nil
}

// extractUserID pulls the user ID from a create-user API response.
func extractUserID(resp map[string]any) string {
	// Try top-level "id" first.
	if id, ok := resp["id"].(string); ok && id != "" {
		return id
	}
	// Try nested "user.id".
	if user, ok := resp["user"].(map[string]any); ok {
		if id, ok := user["id"].(string); ok {
			return id
		}
	}
	return ""
}

// assignUserRoles fetches the role list and assigns each named role to the user.
func assignUserRoles(client *http.Client, sessionCookie, base, userID string, roleNames []string, logger *slog.Logger) {
	if len(roleNames) == 0 {
		return
	}

	// Fetch all roles.
	_, body := apiCall(client, sessionCookie, "GET", base+"/api/v1/roles", nil)
	var rolesResp map[string]any
	if err := json.Unmarshal(body, &rolesResp); err != nil {
		// Try as array.
		var rolesList []any
		if err2 := json.Unmarshal(body, &rolesList); err2 != nil {
			logger.Warn("could not parse roles response")
			return
		}
		rolesResp = map[string]any{"roles": rolesList}
	}

	// Build name-to-ID map.
	roleIDs := make(map[string]string)
	if roles, ok := rolesResp["roles"].([]any); ok {
		for _, r := range roles {
			if role, ok := r.(map[string]any); ok {
				name, _ := role["name"].(string)
				id, _ := role["id"].(string)
				if name != "" && id != "" {
					roleIDs[name] = id
				}
			}
		}
	}

	for _, roleName := range roleNames {
		roleID, ok := roleIDs[roleName]
		if !ok {
			logger.Warn("role not found for assignment", "role", roleName, "user", userID)
			continue
		}
		payload, _ := json.Marshal(map[string]string{"roleId": roleID})
		status, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/users/"+userID+"/roles", payload)
		if status >= 200 && status < 300 {
			logger.Info("role assigned", "role", roleName, "user", userID)
		} else {
			logger.Warn("role assignment failed", "role", roleName, "user", userID, "status", status)
		}
	}
}
