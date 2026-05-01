package sqlite

import (
	"database/sql"
	"encoding/json"
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Scanners
// ---------------------------------------------------------------------------

type scanner interface {
	Scan(dest ...any) error
}

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
		return nil, fmt.Errorf("sqlite: scan route: %w", err)
	}

	matchers, err := store.UnmarshalMatchersJSON(matchersJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal matchers: %w", err)
	}
	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal labels: %w", err)
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
			return nil, fmt.Errorf("sqlite: unmarshal upstream: %w", err)
		}
		route.Target = &riokuv1.Route_Upstream{Upstream: du}
	}

	return route, nil
}

func scanRouteRows(rows *sql.Rows) (*riokuv1.Route, error) {
	return scanRoute(rows)
}

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
		return nil, fmt.Errorf("sqlite: scan service: %w", err)
	}

	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal labels: %w", err)
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
			return nil, fmt.Errorf("sqlite: unmarshal health_check: %w", err)
		}
		svc.HealthCheck = hc
	}

	if phcJSON != nil && *phcJSON != "" {
		phc, err := unmarshalPassiveHealthCheckJSON(*phcJSON)
		if err != nil {
			return nil, fmt.Errorf("sqlite: unmarshal passive_health_check: %w", err)
		}
		svc.PassiveHealthCheck = phc
	}

	if rpJSON != nil && *rpJSON != "" {
		rp, err := unmarshalRetryPolicyJSON(*rpJSON)
		if err != nil {
			return nil, fmt.Errorf("sqlite: unmarshal retry_policy: %w", err)
		}
		svc.RetryPolicy = rp
	}

	if utJSON != nil && *utJSON != "" {
		ut, err := unmarshalUpstreamTLSJSON(*utJSON)
		if err != nil {
			return nil, fmt.Errorf("sqlite: unmarshal upstream_tls: %w", err)
		}
		svc.UpstreamTls = ut
	}

	if cpJSON != nil && *cpJSON != "" {
		cp, err := unmarshalConnectionPoolJSON(*cpJSON)
		if err != nil {
			return nil, fmt.Errorf("sqlite: unmarshal connection_pool: %w", err)
		}
		svc.ConnectionPool = cp
	}

	rh, err := unmarshalRequestHeadersJSON(reqHJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal request_headers: %w", err)
	}
	svc.RequestHeaders = rh

	respH, err := unmarshalResponseHeadersJSON(respHJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal response_headers: %w", err)
	}
	svc.ResponseHeaders = respH

	rules, err := unmarshalResponseRulesJSON(respRulesJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal response_rules: %w", err)
	}
	svc.ResponseRules = rules

	comp, err := unmarshalCompressionJSON(compJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal compression: %w", err)
	}
	svc.Compression = comp

	return svc, nil
}

func scanServiceRows(rows *sql.Rows) (*riokuv1.Service, error) {
	return scanService(rows)
}

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
		return nil, fmt.Errorf("sqlite: scan policy: %w", err)
	}

	config, err := unmarshalStructJSON(configJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal policy config: %w", err)
	}
	labels, err := unmarshalLabelsJSON(labelsJSON)
	if err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal labels: %w", err)
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
		return nil, fmt.Errorf("sqlite: scan user: %w", err)
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
		return nil, fmt.Errorf("sqlite: scan session: %w", err)
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
		return nil, fmt.Errorf("sqlite: scan api_key: %w", err)
	}

	var scopes []string
	if err := json.Unmarshal([]byte(scopesJSON), &scopes); err != nil {
		return nil, fmt.Errorf("sqlite: unmarshal scopes: %w", err)
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
