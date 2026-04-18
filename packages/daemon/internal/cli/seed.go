package cli

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"regexp"
	"strings"

	"github.com/spf13/cobra"
	"gopkg.in/yaml.v3"
)

// ---------------------------------------------------------------------------
// Seed file data model
// ---------------------------------------------------------------------------

// SeedFile represents the top-level structure of a seed YAML file.
type SeedFile struct {
	Roles    []SeedRole    `yaml:"roles"`
	Services []SeedService `yaml:"services"`
	Policies []SeedPolicy  `yaml:"policies"`
	Routes   []SeedRoute   `yaml:"routes"`
	Users    []SeedUser    `yaml:"users"`
	APIKeys  []SeedAPIKey  `yaml:"api_keys"`
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
// Command constructor
// ---------------------------------------------------------------------------

func newSeedCmd() *cobra.Command {
	var (
		seedFile   string
		targetAddr string
		username   string
		password   string
		direct     bool
	)

	cmd := &cobra.Command{
		Use:   "seed",
		Short: "Apply seed data from a YAML file to a running Rioku instance",
		Long: `Reads a YAML seed file and applies services, routes, policies, users,
roles, and API keys to a running Rioku daemon via its REST API.

The seed file supports environment variable substitution using ${VAR:-default} syntax.`,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runSeed(seedFile, targetAddr, username, password, direct)
		},
	}

	cmd.Flags().StringVarP(&seedFile, "file", "f", "", "path to seed YAML file (required)")
	cmd.Flags().StringVar(&targetAddr, "target", "http://localhost:7778", "daemon REST API address")
	cmd.Flags().StringVarP(&username, "username", "u", "root", "admin username for API authentication")
	cmd.Flags().StringVarP(&password, "password", "p", "", "admin password (or set SANDBOX_ROOT_PASSWORD env)")
	cmd.Flags().BoolVar(&direct, "direct", false, "write directly to store, bypassing API (not implemented)")
	_ = cmd.MarkFlagRequired("file")

	return cmd
}

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

func runSeed(seedFile, targetAddr, username, password string, direct bool) error {
	logger := slog.Default().With("component", "seed")

	if direct {
		return fmt.Errorf("--direct mode is not implemented yet")
	}

	// Read and env-substitute the seed file.
	raw, err := os.ReadFile(seedFile)
	if err != nil {
		return fmt.Errorf("read seed file: %w", err)
	}
	raw = envSubstitute(raw)

	var seed SeedFile
	if err := yaml.Unmarshal(raw, &seed); err != nil {
		return fmt.Errorf("parse seed file: %w", err)
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
		resp.Body.Close()
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
	io.ReadAll(resp.Body)
	resp.Body.Close()

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
					if status == "locked" {
						s, _ := apiCall(client, sessionCookie, "POST", base+"/api/v1/users/"+uid+"/lock", []byte("{}"))
						logger.Info("user locked", "username", user.Username, "status", s)
					} else if status == "suspended" {
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

	// Logout.
	_, _ = apiCall(client, sessionCookie, "POST", base+"/api/v1/auth/logout", nil)
	logger.Info("session closed")

	fmt.Printf("Seeded: %d roles, %d services, %d policies, %d routes, %d users, %d API keys\n",
		counts.roles, counts.services, counts.policies, counts.routes, counts.users, counts.apiKeys)

	return nil
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
	defer resp.Body.Close()
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
