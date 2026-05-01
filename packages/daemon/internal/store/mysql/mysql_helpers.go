package mysql

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

// defaultTenantID is the immutable id of the seed tenant created by migrations.
// Operations that target the default tenant by id (e.g. blocking deletion)
// reference this constant.
const defaultTenantID = "tenant_default"

// boolToInt converts a bool to int (1 or 0) for storage in MySQL TINYINT(1)
// columns. Mirrors the SQLite package helper of the same name.
func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}

// isUniqueViolation returns true if err is a MySQL duplicate-entry error
// (Error 1062). Mirrors the isPgUniqueViolation pattern.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	var mErr *mysql.MySQLError
	if errors.As(err, &mErr) {
		return mErr.Number == 1062
	}
	// Fallback: substring match for resilience.
	return strings.Contains(err.Error(), "Error 1062") || strings.Contains(err.Error(), "Duplicate entry")
}

// orEmpty returns s, or an empty non-nil slice if s is nil.
func orEmpty[T any](s []T) []T {
	if s == nil {
		return []T{}
	}
	return s
}

// orEmptyConditions returns c, or an empty non-nil slice if c is nil.
func orEmptyConditions(c []store.AccessPolicyCondition) []store.AccessPolicyCondition {
	if c == nil {
		return []store.AccessPolicyCondition{}
	}
	return c
}

const timeFormat = "2006-01-02T15:04:05.000Z"

// newID generates a prefixed, hyphen-free UUID string in the form
// "<prefix>_<uuid32>". Mirrors the postgres helper of the same name.
// Pass a short, lower-case prefix that identifies the entity type
// (e.g. "notif", "plug", "hook").
func newID(prefix string) string {
	return prefix + "_" + strings.ReplaceAll(uuid.New().String(), "-", "")
}

// nowUTC returns the current time in UTC formatted as a string.
func nowUTC() string {
	return time.Now().UTC().Format(timeFormat)
}

// parseTime parses a formatted time string back into time.Time.
// Logs a warning and returns the zero value if parsing fails.
func parseTime(s string) time.Time {
	t, err := time.Parse(timeFormat, s)
	if err != nil && s != "" {
		slog.Warn("failed to parse time", "component", "store", "value", s, "error", err)
	}
	return t
}

// emit sends a non-blocking change event on the driver notification channel.
// If the channel is full the event is dropped and a warning is logged.
func (t *tx) emit(table, rowID, operation string) {
	select {
	case t.notify <- store.ChangeEvent{Table: table, RowID: rowID, Operation: operation}:
	default:
		slog.Warn("change event dropped (channel full)", "component", "store", "table", table, "row_id", rowID, "operation", operation)
	}
}

// ---------------------------------------------------------------------------
// scanner interface
// ---------------------------------------------------------------------------

// scanner is a method-set adapter that allows the same scan helper to accept
// both *sql.Row (single row) and *sql.Rows (multi-row cursor).
type scanner interface {
	Scan(dest ...any) error
}

// ---------------------------------------------------------------------------
// Route scanners
// ---------------------------------------------------------------------------

func scanRoute(s scanner) (*riokuv1.Route, error) {
	var (
		id              string
		name            string
		matchersJSON    string
		targetServiceID *string
		targetUpstream  *string
		enabled         int
		labelsJSON      string
		createdAt       string
		updatedAt       string
	)

	if err := s.Scan(&id, &name, &matchersJSON, &targetServiceID, &targetUpstream, &enabled, &labelsJSON, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("mysql: scan route: %w", err)
	}

	matchers, err := store.UnmarshalMatchersJSON(matchersJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal matchers: %w", err)
	}
	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal labels: %w", err)
	}

	route := &riokuv1.Route{
		Id:        id,
		Name:      name,
		Matchers:  matchers,
		Enabled:   enabled != 0,
		Labels:    labels,
		CreatedAt: timestamppb.New(parseTime(createdAt)),
		UpdatedAt: timestamppb.New(parseTime(updatedAt)),
	}

	if targetServiceID != nil {
		route.Target = &riokuv1.Route_ServiceId{ServiceId: *targetServiceID}
	} else if targetUpstream != nil {
		du, err := unmarshalDirectUpstreamJSON(*targetUpstream)
		if err != nil {
			return nil, fmt.Errorf("mysql: unmarshal upstream: %w", err)
		}
		route.Target = &riokuv1.Route_Upstream{Upstream: du}
	}

	return route, nil
}

func scanRouteRows(rows *sql.Rows) (*riokuv1.Route, error) {
	return scanRoute(rows)
}

// ---------------------------------------------------------------------------
// Service scanners
// ---------------------------------------------------------------------------

func scanService(s scanner) (*riokuv1.Service, error) {
	var (
		id                           string
		name                         string
		lbPolicy                     int32
		hcJSON                       *string
		labelsJSON                   string
		createdAt                    string
		updatedAt                    string
		dialTimeoutSeconds           int32
		responseHeaderTimeoutSeconds int32
		idleTimeoutSeconds           int32
		phcJSON                      *string
		rpJSON                       *string
		utJSON                       *string
		cpJSON                       *string
		lbCookieName                 string
		lbHeaderName                 string
		reqHJSON                     string
		respHJSON                    string
		respRulesJSON                string
		compJSON                     string
	)
	if err := s.Scan(&id, &name, &lbPolicy, &hcJSON, &labelsJSON, &createdAt, &updatedAt,
		&dialTimeoutSeconds, &responseHeaderTimeoutSeconds, &idleTimeoutSeconds,
		&phcJSON, &rpJSON, &utJSON, &cpJSON, &lbCookieName, &lbHeaderName,
		&reqHJSON, &respHJSON, &respRulesJSON, &compJSON); err != nil {
		return nil, fmt.Errorf("mysql: scan service: %w", err)
	}

	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal labels: %w", err)
	}

	svc := &riokuv1.Service{
		Id:                           id,
		Name:                         name,
		LbPolicy:                     riokuv1.LoadBalancingPolicy(lbPolicy),
		Labels:                       labels,
		CreatedAt:                    timestamppb.New(parseTime(createdAt)),
		UpdatedAt:                    timestamppb.New(parseTime(updatedAt)),
		DialTimeoutSeconds:           dialTimeoutSeconds,
		ResponseHeaderTimeoutSeconds: responseHeaderTimeoutSeconds,
		IdleTimeoutSeconds:           idleTimeoutSeconds,
		LbCookieName:                 lbCookieName,
		LbHeaderName:                 lbHeaderName,
	}

	if hcJSON != nil && *hcJSON != "" {
		hc, err := unmarshalHealthCheckJSON(*hcJSON)
		if err != nil {
			return nil, fmt.Errorf("mysql: unmarshal health_check: %w", err)
		}
		svc.HealthCheck = hc
	}

	if phcJSON != nil && *phcJSON != "" {
		phc, err := unmarshalPassiveHealthCheckJSON(*phcJSON)
		if err != nil {
			return nil, fmt.Errorf("mysql: unmarshal passive_health_check: %w", err)
		}
		svc.PassiveHealthCheck = phc
	}

	if rpJSON != nil && *rpJSON != "" {
		rp, err := unmarshalRetryPolicyJSON(*rpJSON)
		if err != nil {
			return nil, fmt.Errorf("mysql: unmarshal retry_policy: %w", err)
		}
		svc.RetryPolicy = rp
	}

	if utJSON != nil && *utJSON != "" {
		ut, err := unmarshalUpstreamTLSJSON(*utJSON)
		if err != nil {
			return nil, fmt.Errorf("mysql: unmarshal upstream_tls: %w", err)
		}
		svc.UpstreamTls = ut
	}

	if cpJSON != nil && *cpJSON != "" {
		cp, err := unmarshalConnectionPoolJSON(*cpJSON)
		if err != nil {
			return nil, fmt.Errorf("mysql: unmarshal connection_pool: %w", err)
		}
		svc.ConnectionPool = cp
	}

	rh, err := unmarshalRequestHeadersJSON(reqHJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal request_headers: %w", err)
	}
	svc.RequestHeaders = rh

	respH, err := unmarshalResponseHeadersJSON(respHJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal response_headers: %w", err)
	}
	svc.ResponseHeaders = respH

	rules, err := unmarshalResponseRulesJSON(respRulesJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal response_rules: %w", err)
	}
	svc.ResponseRules = rules

	comp, err := unmarshalCompressionJSON(compJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal compression: %w", err)
	}
	svc.Compression = comp

	return svc, nil
}

func scanServiceRows(rows *sql.Rows) (*riokuv1.Service, error) {
	return scanService(rows)
}

// ---------------------------------------------------------------------------
// Policy scanners
// ---------------------------------------------------------------------------

func scanPolicy(s scanner) (*riokuv1.Policy, error) {
	var (
		id         string
		name       string
		pType      int32
		configJSON string
		labelsJSON string
		createdAt  string
		updatedAt  string
	)
	if err := s.Scan(&id, &name, &pType, &configJSON, &labelsJSON, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("mysql: scan policy: %w", err)
	}

	config, err := unmarshalStructJSON(configJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal policy config: %w", err)
	}
	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("mysql: unmarshal labels: %w", err)
	}

	return &riokuv1.Policy{
		Id:        id,
		Name:      name,
		Type:      riokuv1.PolicyType(pType),
		Config:    config,
		Labels:    labels,
		CreatedAt: timestamppb.New(parseTime(createdAt)),
		UpdatedAt: timestamppb.New(parseTime(updatedAt)),
	}, nil
}

func scanPolicyRows(rows *sql.Rows) (*riokuv1.Policy, error) {
	return scanPolicy(rows)
}

// ---------------------------------------------------------------------------
// JSON marshal / unmarshal helpers
// ---------------------------------------------------------------------------

func marshalDirectUpstreamJSON(u *riokuv1.DirectUpstream) (string, error) {
	if u == nil {
		return "", nil
	}
	b, err := protojson.Marshal(u)
	return string(b), err
}

func unmarshalDirectUpstreamJSON(s string) (*riokuv1.DirectUpstream, error) {
	du := &riokuv1.DirectUpstream{}
	if err := protojson.Unmarshal([]byte(s), du); err != nil {
		return nil, err
	}
	return du, nil
}

func marshalLabelsJSON(labels *riokuv1.Labels) (string, error) {
	if labels == nil || labels.GetLabels() == nil {
		return "{}", nil
	}
	b, err := json.Marshal(labels.GetLabels())
	return string(b), err
}

func unmarshalLabelsJSON(s string) (*riokuv1.Labels, error) {
	if s == "" || s == "{}" {
		return &riokuv1.Labels{Labels: map[string]string{}}, nil
	}
	m := make(map[string]string)
	if err := json.Unmarshal([]byte(s), &m); err != nil {
		return nil, err
	}
	if len(m) == 0 {
		return &riokuv1.Labels{Labels: map[string]string{}}, nil
	}
	return &riokuv1.Labels{Labels: m}, nil
}

func marshalHealthCheckJSON(hc *riokuv1.HealthCheck) (*string, error) {
	if hc == nil {
		return nil, nil
	}
	b, err := protojson.Marshal(hc)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func unmarshalHealthCheckJSON(s string) (*riokuv1.HealthCheck, error) {
	hc := &riokuv1.HealthCheck{}
	if err := protojson.Unmarshal([]byte(s), hc); err != nil {
		return nil, err
	}
	return hc, nil
}

func marshalPassiveHealthCheckJSON(phc *riokuv1.PassiveHealthCheck) (*string, error) {
	if phc == nil {
		return nil, nil
	}
	b, err := protojson.Marshal(phc)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func unmarshalPassiveHealthCheckJSON(s string) (*riokuv1.PassiveHealthCheck, error) {
	phc := &riokuv1.PassiveHealthCheck{}
	if err := protojson.Unmarshal([]byte(s), phc); err != nil {
		return nil, err
	}
	return phc, nil
}

func marshalRetryPolicyJSON(rp *riokuv1.RetryPolicy) (*string, error) {
	if rp == nil {
		return nil, nil
	}
	b, err := protojson.Marshal(rp)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func unmarshalRetryPolicyJSON(s string) (*riokuv1.RetryPolicy, error) {
	rp := &riokuv1.RetryPolicy{}
	if err := protojson.Unmarshal([]byte(s), rp); err != nil {
		return nil, err
	}
	return rp, nil
}

func marshalUpstreamTLSJSON(ut *riokuv1.UpstreamTLS) (*string, error) {
	if ut == nil {
		return nil, nil
	}
	b, err := protojson.Marshal(ut)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func unmarshalUpstreamTLSJSON(s string) (*riokuv1.UpstreamTLS, error) {
	ut := &riokuv1.UpstreamTLS{}
	if err := protojson.Unmarshal([]byte(s), ut); err != nil {
		return nil, err
	}
	return ut, nil
}

func marshalConnectionPoolJSON(cp *riokuv1.ConnectionPool) (*string, error) {
	if cp == nil {
		return nil, nil
	}
	b, err := protojson.Marshal(cp)
	if err != nil {
		return nil, err
	}
	s := string(b)
	return &s, nil
}

func unmarshalConnectionPoolJSON(s string) (*riokuv1.ConnectionPool, error) {
	cp := &riokuv1.ConnectionPool{}
	if err := protojson.Unmarshal([]byte(s), cp); err != nil {
		return nil, err
	}
	return cp, nil
}

// ---------------------------------------------------------------------------
// Phase 7a / #161: caddy primitives marshal/unmarshal helpers
// ---------------------------------------------------------------------------

func marshalRequestHeadersJSON(rh *riokuv1.RequestHeaders) (string, error) {
	if rh == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(rh)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func unmarshalRequestHeadersJSON(s string) (*riokuv1.RequestHeaders, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	rh := &riokuv1.RequestHeaders{}
	if err := protojson.Unmarshal([]byte(s), rh); err != nil {
		return nil, err
	}
	return rh, nil
}

func marshalResponseHeadersJSON(rh *riokuv1.ResponseHeaders) (string, error) {
	if rh == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(rh)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func unmarshalResponseHeadersJSON(s string) (*riokuv1.ResponseHeaders, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	rh := &riokuv1.ResponseHeaders{}
	if err := protojson.Unmarshal([]byte(s), rh); err != nil {
		return nil, err
	}
	return rh, nil
}

func marshalCompressionJSON(comp *riokuv1.Compression) (string, error) {
	if comp == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(comp)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

func unmarshalCompressionJSON(s string) (*riokuv1.Compression, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	comp := &riokuv1.Compression{}
	if err := protojson.Unmarshal([]byte(s), comp); err != nil {
		return nil, err
	}
	return comp, nil
}

func marshalResponseRulesJSON(rules []*riokuv1.ResponseRule) (string, error) {
	if len(rules) == 0 {
		return "[]", nil
	}
	var arr []json.RawMessage
	for _, r := range rules {
		b, err := protojson.Marshal(r)
		if err != nil {
			return "", err
		}
		arr = append(arr, b)
	}
	out, err := json.Marshal(arr)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func unmarshalResponseRulesJSON(s string) ([]*riokuv1.ResponseRule, error) {
	if s == "" || s == "[]" {
		return nil, nil
	}
	var arr []json.RawMessage
	if err := json.Unmarshal([]byte(s), &arr); err != nil {
		return nil, err
	}
	rules := make([]*riokuv1.ResponseRule, 0, len(arr))
	for _, b := range arr {
		r := &riokuv1.ResponseRule{}
		if err := protojson.Unmarshal(b, r); err != nil {
			return nil, err
		}
		rules = append(rules, r)
	}
	return rules, nil
}

// formatNullableTime formats a *time.Time as a *string for nullable timestamp
// columns. Returns nil when t is nil.
func formatNullableTime(t *time.Time) *string {
	if t == nil {
		return nil
	}
	s := t.UTC().Format(timeFormat)
	return &s
}

// ---------------------------------------------------------------------------
// User / Session / APIKey scanners
// ---------------------------------------------------------------------------

func scanUser(s scanner) (*store.User, error) {
	var (
		id                  string
		username            string
		email               sql.NullString
		displayName         sql.NullString
		passwordHash        string
		status              string
		totpSecret          sql.NullString
		totpEnabled         int
		forcePasswordChange int
		failedAttempts      int
		lockedUntil         sql.NullString
		lastLogin           sql.NullString
		passwordChangedAt   string
		createdAt           string
		updatedAt           string
	)

	if err := s.Scan(&id, &username, &email, &displayName, &passwordHash, &status,
		&totpSecret, &totpEnabled, &forcePasswordChange,
		&failedAttempts, &lockedUntil, &lastLogin,
		&passwordChangedAt, &createdAt, &updatedAt); err != nil {
		return nil, fmt.Errorf("mysql: scan user: %w", err)
	}

	u := &store.User{
		ID:                  id,
		Username:            username,
		PasswordHash:        passwordHash,
		Status:              status,
		TOTPEnabled:         totpEnabled != 0,
		ForcePasswordChange: forcePasswordChange != 0,
		FailedAttempts:      failedAttempts,
		PasswordChangedAt:   parseTime(passwordChangedAt),
		CreatedAt:           parseTime(createdAt),
		UpdatedAt:           parseTime(updatedAt),
	}
	if email.Valid {
		u.Email = &email.String
	}
	if displayName.Valid {
		u.DisplayName = &displayName.String
	}
	if totpSecret.Valid {
		u.TOTPSecret = &totpSecret.String
	}
	if lockedUntil.Valid {
		t := parseTime(lockedUntil.String)
		u.LockedUntil = &t
	}
	if lastLogin.Valid {
		t := parseTime(lastLogin.String)
		u.LastLogin = &t
	}
	return u, nil
}

func scanSession(s scanner) (*store.Session, error) {
	var (
		id          string
		userID      string
		fingerprint string
		createdAt   string
		expiresAt   string
		lastActive  string
		ipAddress   sql.NullString
		userAgent   sql.NullString
	)

	if err := s.Scan(&id, &userID, &fingerprint, &createdAt, &expiresAt, &lastActive, &ipAddress, &userAgent); err != nil {
		return nil, fmt.Errorf("mysql: scan session: %w", err)
	}

	sess := &store.Session{
		ID:          id,
		UserID:      userID,
		Fingerprint: fingerprint,
		CreatedAt:   parseTime(createdAt),
		ExpiresAt:   parseTime(expiresAt),
		LastActive:  parseTime(lastActive),
	}
	if ipAddress.Valid {
		sess.IPAddress = &ipAddress.String
	}
	if userAgent.Valid {
		sess.UserAgent = &userAgent.String
	}
	return sess, nil
}

func scanAPIKey(s scanner) (*store.APIKey, error) {
	var (
		id         string
		tenantID   string
		name       string
		keyHash    string
		scopesJSON string
		expiresAt  *string
		createdAt  string
		revokedAt  *string
		ownerID    *string
		lastUsedAt *string
		usageCount int64
	)
	if err := s.Scan(&id, &tenantID, &name, &keyHash, &scopesJSON, &expiresAt, &createdAt, &revokedAt, &ownerID, &lastUsedAt, &usageCount); err != nil {
		return nil, fmt.Errorf("mysql: scan api_key: %w", err)
	}

	var scopes []string
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return nil, fmt.Errorf("mysql: unmarshal scopes: %w", err)
	}

	key := &store.APIKey{
		ID:         id,
		TenantID:   tenantID,
		Name:       name,
		KeyHash:    keyHash,
		Scopes:     scopes,
		CreatedAt:  parseTime(createdAt),
		UsageCount: usageCount,
	}
	if ownerID != nil {
		key.OwnerID = *ownerID
	}
	if expiresAt != nil {
		t := parseTime(*expiresAt)
		key.ExpiresAt = &t
	}
	if revokedAt != nil {
		t := parseTime(*revokedAt)
		key.RevokedAt = &t
	}
	if lastUsedAt != nil {
		t := parseTime(*lastUsedAt)
		key.LastUsedAt = &t
	}
	return key, nil
}

func scanAPIKeyRows(rows *sql.Rows) (*store.APIKey, error) {
	return scanAPIKey(rows)
}

func marshalStructJSON(st *structpb.Struct) (string, error) {
	if st == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(st)
	return string(b), err
}

func unmarshalStructJSON(s string) (*structpb.Struct, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	st := &structpb.Struct{}
	if err := protojson.Unmarshal([]byte(s), st); err != nil {
		return nil, err
	}
	return st, nil
}

// ---------------------------------------------------------------------------
// Phase 7b / #162, #159 residual: dynamic-upstream + trusted-proxies helpers
// ---------------------------------------------------------------------------

// marshalUpstreamSourceJSON returns (sourceType, sourceJSON) for an Upstream.
func marshalUpstreamSourceJSON(u *riokuv1.Upstream) (string, string, error) {
	switch src := u.GetSource().(type) {
	case *riokuv1.Upstream_SrvLookup:
		b, err := protojson.Marshal(src.SrvLookup)
		if err != nil {
			return "", "", err
		}
		return "srv", string(b), nil
	case *riokuv1.Upstream_ALookup:
		b, err := protojson.Marshal(src.ALookup)
		if err != nil {
			return "", "", err
		}
		return "a", string(b), nil
	default:
		return "", "{}", nil
	}
}

// unmarshalUpstreamSource sets the Source oneof on u from (sourceType, sourceJSON).
func unmarshalUpstreamSource(u *riokuv1.Upstream, sourceType, sourceJSON string) error {
	switch sourceType {
	case "srv":
		if sourceJSON == "" || sourceJSON == "{}" {
			return nil
		}
		srv := &riokuv1.SrvLookup{}
		if err := protojson.Unmarshal([]byte(sourceJSON), srv); err != nil {
			return err
		}
		u.Source = &riokuv1.Upstream_SrvLookup{SrvLookup: srv}
	case "a":
		if sourceJSON == "" || sourceJSON == "{}" {
			return nil
		}
		al := &riokuv1.ALookup{}
		if err := protojson.Unmarshal([]byte(sourceJSON), al); err != nil {
			return err
		}
		u.Source = &riokuv1.Upstream_ALookup{ALookup: al}
	}
	return nil
}
