// Package postgres — SSO providers.
package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

func (t *tx) CreateSsoProvider(ctx context.Context, in *store.SsoProvider) (*store.SsoProvider, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.Kind == "" {
		return nil, fmt.Errorf("postgres: sso_provider requires tenant_id, name, kind")
	}
	id := in.ID
	if id == "" {
		id = newID("sso")
	}
	scopes := in.OIDCScopes
	if scopes == "" {
		scopes = "[]"
	}
	mapping := in.ClaimsMapping
	if mapping == "" {
		mapping = "{}"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO sso_providers (
		   id, tenant_id, name, kind,
		   oidc_issuer, oidc_client_id, oidc_client_secret_ref,
		   oidc_scopes, claims_mapping, enabled, created_at, updated_at
		 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		id, in.TenantID, in.Name, in.Kind,
		ssoNullStr(in.OIDCIssuer), ssoNullStr(in.OIDCClientID), ssoNullStr(in.OIDCClientSecretRef),
		scopes, mapping, in.Enabled, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrSsoProviderTaken
		}
		return nil, fmt.Errorf("postgres: insert sso_provider: %w", err)
	}
	t.emit("sso_providers", id, "INSERT")
	return t.GetSsoProvider(ctx, in.TenantID, id)
}

func (t *tx) GetSsoProvider(ctx context.Context, tenantID, id string) (*store.SsoProvider, error) {
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, kind,
		        oidc_issuer, oidc_client_id, oidc_client_secret_ref,
		        oidc_scopes, claims_mapping, enabled, created_at, updated_at
		 FROM sso_providers WHERE id = ? AND tenant_id = ?`), id, tenantID)
	p, err := scanSsoProvider(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrSsoProviderNotFound
	}
	return p, err
}

func (t *tx) ListSsoProvidersByTenant(ctx context.Context, tenantID string) ([]*store.SsoProvider, error) {
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT id, tenant_id, name, kind,
		        oidc_issuer, oidc_client_id, oidc_client_secret_ref,
		        oidc_scopes, claims_mapping, enabled, created_at, updated_at
		 FROM sso_providers WHERE tenant_id = ? ORDER BY name ASC`), tenantID)
	if err != nil {
		return nil, fmt.Errorf("postgres: list sso_providers: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.SsoProvider
	for rows.Next() {
		p, err := scanSsoProvider(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdateSsoProvider(ctx context.Context, tenantID, id string, p store.UpdateSsoProviderParams) (*store.SsoProvider, error) {
	cur, err := t.GetSsoProvider(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		cur.Name = *p.Name
	}
	if p.Kind != nil {
		cur.Kind = *p.Kind
	}
	if p.OIDCIssuer != nil {
		cur.OIDCIssuer = ssoStrPtrOrNil(*p.OIDCIssuer)
	}
	if p.OIDCClientID != nil {
		cur.OIDCClientID = ssoStrPtrOrNil(*p.OIDCClientID)
	}
	if p.OIDCClientSecretRef != nil {
		cur.OIDCClientSecretRef = ssoStrPtrOrNil(*p.OIDCClientSecretRef)
	}
	if p.OIDCScopes != nil {
		cur.OIDCScopes = *p.OIDCScopes
	}
	if p.ClaimsMapping != nil {
		cur.ClaimsMapping = *p.ClaimsMapping
	}
	if p.Enabled != nil {
		cur.Enabled = *p.Enabled
	}
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE sso_providers SET name=?, kind=?,
		   oidc_issuer=?, oidc_client_id=?, oidc_client_secret_ref=?,
		   oidc_scopes=?, claims_mapping=?, enabled=?, updated_at=?
		 WHERE id=? AND tenant_id=?`),
		cur.Name, cur.Kind,
		ssoNullStr(cur.OIDCIssuer), ssoNullStr(cur.OIDCClientID), ssoNullStr(cur.OIDCClientSecretRef),
		cur.OIDCScopes, cur.ClaimsMapping, cur.Enabled, nowUTC(), id, tenantID); err != nil {
		if isPgUniqueViolation(err, "name") {
			return nil, store.ErrSsoProviderTaken
		}
		return nil, fmt.Errorf("postgres: update sso_provider: %w", err)
	}
	t.emit("sso_providers", id, "UPDATE")
	return t.GetSsoProvider(ctx, tenantID, id)
}

func (t *tx) DeleteSsoProvider(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM sso_providers WHERE id = ? AND tenant_id = ?`), id, tenantID)
	if err != nil {
		return fmt.Errorf("postgres: delete sso_provider: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrSsoProviderNotFound
	}
	t.emit("sso_providers", id, "DELETE")
	return nil
}

func scanSsoProvider(s scanner) (*store.SsoProvider, error) {
	var (
		id, tenantID, name, kind, scopes, mapping string
		issuer, clientID, secretRef               sql.NullString
		enabled                                   bool
		createdAt, updatedAt                      time.Time
	)
	if err := s.Scan(&id, &tenantID, &name, &kind,
		&issuer, &clientID, &secretRef,
		&scopes, &mapping, &enabled, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	return &store.SsoProvider{
		ID: id, TenantID: tenantID, Name: name, Kind: kind,
		OIDCIssuer:          ssoNullStrPtr(issuer),
		OIDCClientID:        ssoNullStrPtr(clientID),
		OIDCClientSecretRef: ssoNullStrPtr(secretRef),
		OIDCScopes:          scopes,
		ClaimsMapping:       mapping,
		Enabled:             enabled,
		CreatedAt:           createdAt.UTC(),
		UpdatedAt:           updatedAt.UTC(),
	}, nil
}

func ssoNullStr(p *string) any {
	if p == nil || *p == "" {
		return nil
	}
	return *p
}

func ssoStrPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func ssoNullStrPtr(n sql.NullString) *string {
	if !n.Valid || n.String == "" {
		return nil
	}
	s := n.String
	return &s
}
