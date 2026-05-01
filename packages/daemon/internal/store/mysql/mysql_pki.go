// Package mysql — PKI/TLS subsystem CRUD (stage-2).
package mysql

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Cert Authorities
// ---------------------------------------------------------------------------

func (t *tx) CreateCertAuthority(ctx context.Context, in *store.CertAuthority) (*store.CertAuthority, error) {
	if in == nil || in.TenantID == "" || in.Name == "" || in.Kind == "" || in.Subject == "" {
		return nil, fmt.Errorf("mysql: cert_authority requires tenant_id, name, kind, subject")
	}
	id := in.ID
	if id == "" {
		id = newID()
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO cert_authorities (id, tenant_id, name, kind, subject, not_before, not_after,
		   fingerprint_sha256, certificate_pem, private_key_ref, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Name, in.Kind, in.Subject,
		formatNullableTime(in.NotBefore), formatNullableTime(in.NotAfter),
		in.FingerprintSHA256, in.CertificatePEM, in.PrivateKeyRef, now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrCertAuthorityNameTaken
		}
		return nil, fmt.Errorf("mysql: insert cert_authority: %w", err)
	}
	t.emit("cert_authorities", id, "INSERT")
	return t.GetCertAuthority(ctx, in.TenantID, id)
}

func (t *tx) GetCertAuthority(ctx context.Context, tenantID, id string) (*store.CertAuthority, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, name, kind, subject, not_before, not_after,
		   fingerprint_sha256, certificate_pem, private_key_ref, created_at, updated_at
		 FROM cert_authorities WHERE id = ? AND tenant_id = ?`, id, tenantID)
	c, err := scanCertAuthority(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrCertAuthorityNotFound
	}
	return c, err
}

func (t *tx) ListCertAuthoritiesByTenant(ctx context.Context, tenantID string) ([]*store.CertAuthority, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, name, kind, subject, not_before, not_after,
		   fingerprint_sha256, certificate_pem, private_key_ref, created_at, updated_at
		 FROM cert_authorities WHERE tenant_id = ? ORDER BY name ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list cert_authorities: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.CertAuthority
	for rows.Next() {
		c, err := scanCertAuthority(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (t *tx) UpdateCertAuthority(ctx context.Context, tenantID, id string, p store.UpdateCertAuthorityParams) (*store.CertAuthority, error) {
	c, err := t.GetCertAuthority(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Name != nil {
		c.Name = *p.Name
	}
	if p.Kind != nil {
		c.Kind = *p.Kind
	}
	if p.Subject != nil {
		c.Subject = *p.Subject
	}
	if p.NotBefore != nil {
		c.NotBefore = p.NotBefore
	}
	if p.NotAfter != nil {
		c.NotAfter = p.NotAfter
	}
	if p.FingerprintSHA256 != nil {
		c.FingerprintSHA256 = p.FingerprintSHA256
	}
	if p.CertificatePEM != nil {
		c.CertificatePEM = *p.CertificatePEM
	}
	if p.PrivateKeyRef != nil {
		c.PrivateKeyRef = p.PrivateKeyRef
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE cert_authorities SET name=?, kind=?, subject=?, not_before=?, not_after=?,
		   fingerprint_sha256=?, certificate_pem=?, private_key_ref=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Name, c.Kind, c.Subject, formatNullableTime(c.NotBefore), formatNullableTime(c.NotAfter),
		c.FingerprintSHA256, c.CertificatePEM, c.PrivateKeyRef, nowUTC(), id, tenantID); err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrCertAuthorityNameTaken
		}
		return nil, fmt.Errorf("mysql: update cert_authority: %w", err)
	}
	t.emit("cert_authorities", id, "UPDATE")
	return t.GetCertAuthority(ctx, tenantID, id)
}

func (t *tx) DeleteCertAuthority(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM cert_authorities WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete cert_authority: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrCertAuthorityNotFound
	}
	t.emit("cert_authorities", id, "DELETE")
	return nil
}

func scanCertAuthority(s scanner) (*store.CertAuthority, error) {
	var (
		id, tenantID, name, kind, subject, certPEM, createdAt, updatedAt string
		notBefore, notAfter, fp, keyRef                                  *string
	)
	if err := s.Scan(&id, &tenantID, &name, &kind, &subject, &notBefore, &notAfter,
		&fp, &certPEM, &keyRef, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	out := &store.CertAuthority{
		ID: id, TenantID: tenantID, Name: name, Kind: kind, Subject: subject,
		FingerprintSHA256: fp, CertificatePEM: certPEM, PrivateKeyRef: keyRef,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}
	if notBefore != nil {
		ts := parseTime(*notBefore)
		out.NotBefore = &ts
	}
	if notAfter != nil {
		ts := parseTime(*notAfter)
		out.NotAfter = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Cert Enrollments
// ---------------------------------------------------------------------------

func (t *tx) CreateCertEnrollment(ctx context.Context, in *store.CertEnrollment) (*store.CertEnrollment, error) {
	if in == nil || in.TenantID == "" || in.Subject == "" {
		return nil, fmt.Errorf("mysql: cert_enrollment requires tenant_id, subject")
	}
	id := in.ID
	if id == "" {
		id = newID()
	}
	state := in.State
	if state == "" {
		state = "pending"
	}
	sans := in.DNSSANs
	if sans == "" {
		sans = "[]"
	}
	now := nowUTC()
	requestedAt := now
	if !in.RequestedAt.IsZero() {
		requestedAt = in.RequestedAt.UTC().Format(timeFormat)
	}
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO cert_enrollments (id, tenant_id, ca_id, subject, dns_sans, state,
		   requested_at, issued_at, revoked_at, revocation_reason, certificate_pem, chain_pem,
		   fingerprint_sha256, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.CAID, in.Subject, sans, state,
		requestedAt, formatNullableTime(in.IssuedAt), formatNullableTime(in.RevokedAt),
		in.RevocationReason, in.CertificatePEM, in.ChainPEM, in.FingerprintSHA256, now, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: insert cert_enrollment: %w", err)
	}
	t.emit("cert_enrollments", id, "INSERT")
	return t.GetCertEnrollment(ctx, in.TenantID, id)
}

func (t *tx) GetCertEnrollment(ctx context.Context, tenantID, id string) (*store.CertEnrollment, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, ca_id, subject, dns_sans, state, requested_at, issued_at,
		   revoked_at, revocation_reason, certificate_pem, chain_pem, fingerprint_sha256, created_at, updated_at
		 FROM cert_enrollments WHERE id = ? AND tenant_id = ?`, id, tenantID)
	e, err := scanCertEnrollment(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrCertEnrollmentNotFound
	}
	return e, err
}

func (t *tx) ListCertEnrollmentsByTenant(ctx context.Context, tenantID string) ([]*store.CertEnrollment, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, ca_id, subject, dns_sans, state, requested_at, issued_at,
		   revoked_at, revocation_reason, certificate_pem, chain_pem, fingerprint_sha256, created_at, updated_at
		 FROM cert_enrollments WHERE tenant_id = ? ORDER BY requested_at DESC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list cert_enrollments: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.CertEnrollment
	for rows.Next() {
		e, err := scanCertEnrollment(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

func (t *tx) UpdateCertEnrollment(ctx context.Context, tenantID, id string, p store.UpdateCertEnrollmentParams) (*store.CertEnrollment, error) {
	c, err := t.GetCertEnrollment(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.State != nil {
		c.State = *p.State
	}
	if p.IssuedAt != nil {
		c.IssuedAt = p.IssuedAt
	}
	if p.CertificatePEM != nil {
		c.CertificatePEM = *p.CertificatePEM
	}
	if p.ChainPEM != nil {
		c.ChainPEM = *p.ChainPEM
	}
	if p.FingerprintSHA256 != nil {
		c.FingerprintSHA256 = p.FingerprintSHA256
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE cert_enrollments SET state=?, issued_at=?, certificate_pem=?, chain_pem=?,
		   fingerprint_sha256=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.State, formatNullableTime(c.IssuedAt), c.CertificatePEM, c.ChainPEM,
		c.FingerprintSHA256, nowUTC(), id, tenantID); err != nil {
		return nil, fmt.Errorf("mysql: update cert_enrollment: %w", err)
	}
	t.emit("cert_enrollments", id, "UPDATE")
	return t.GetCertEnrollment(ctx, tenantID, id)
}

func (t *tx) RevokeCertEnrollmentRow(ctx context.Context, tenantID, id, reason string) (*store.CertEnrollment, error) {
	c, err := t.GetCertEnrollment(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	c.State = "revoked"
	c.RevokedAt = &now
	c.RevocationReason = &reason
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE cert_enrollments SET state='revoked', revoked_at=?, revocation_reason=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		now.Format(timeFormat), reason, nowUTC(), id, tenantID); err != nil {
		return nil, fmt.Errorf("mysql: revoke cert_enrollment: %w", err)
	}
	t.emit("cert_enrollments", id, "UPDATE")
	return t.GetCertEnrollment(ctx, tenantID, id)
}

func scanCertEnrollment(s scanner) (*store.CertEnrollment, error) {
	var (
		id, tenantID, subject, sans, state, requestedAt, certPEM, chainPEM, createdAt, updatedAt string
		caID, issuedAt, revokedAt, revocationReason, fp                                          *string
	)
	if err := s.Scan(&id, &tenantID, &caID, &subject, &sans, &state, &requestedAt, &issuedAt,
		&revokedAt, &revocationReason, &certPEM, &chainPEM, &fp, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	out := &store.CertEnrollment{
		ID: id, TenantID: tenantID, CAID: caID, Subject: subject, DNSSANs: sans, State: state,
		RequestedAt: parseTime(requestedAt), CertificatePEM: certPEM, ChainPEM: chainPEM,
		FingerprintSHA256: fp, RevocationReason: revocationReason,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}
	if issuedAt != nil {
		ts := parseTime(*issuedAt)
		out.IssuedAt = &ts
	}
	if revokedAt != nil {
		ts := parseTime(*revokedAt)
		out.RevokedAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// TLS Certificates
// ---------------------------------------------------------------------------

func (t *tx) CreateTLSCertificate(ctx context.Context, in *store.TLSCertificate) (*store.TLSCertificate, error) {
	if in == nil || in.TenantID == "" || in.Domain == "" {
		return nil, fmt.Errorf("mysql: tls_certificate requires tenant_id, domain")
	}
	id := in.ID
	if id == "" {
		id = newID()
	}
	source := in.Source
	if source == "" {
		source = "acme"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO tls_certificates (id, tenant_id, domain, issuer, source, expires_at, auto_renew,
		   fingerprint_sha256, certificate_pem, private_key_ref, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		id, in.TenantID, in.Domain, in.Issuer, source, formatNullableTime(in.ExpiresAt),
		boolToInt(in.AutoRenew), in.FingerprintSHA256, in.CertificatePEM, in.PrivateKeyRef, now, now,
	)
	if err != nil {
		if isUniqueViolation(err) {
			return nil, store.ErrTLSCertificateTaken
		}
		return nil, fmt.Errorf("mysql: insert tls_certificate: %w", err)
	}
	t.emit("tls_certificates", id, "INSERT")
	return t.GetTLSCertificate(ctx, in.TenantID, id)
}

func (t *tx) GetTLSCertificate(ctx context.Context, tenantID, id string) (*store.TLSCertificate, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT id, tenant_id, domain, issuer, source, expires_at, auto_renew,
		   fingerprint_sha256, certificate_pem, private_key_ref, created_at, updated_at
		 FROM tls_certificates WHERE id = ? AND tenant_id = ?`, id, tenantID)
	c, err := scanTLSCertificate(row)
	if err == sql.ErrNoRows {
		return nil, store.ErrTLSCertificateNotFound
	}
	return c, err
}

func (t *tx) ListTLSCertificatesByTenant(ctx context.Context, tenantID string) ([]*store.TLSCertificate, error) {
	rows, err := t.sqlTx.QueryContext(ctx,
		`SELECT id, tenant_id, domain, issuer, source, expires_at, auto_renew,
		   fingerprint_sha256, certificate_pem, private_key_ref, created_at, updated_at
		 FROM tls_certificates WHERE tenant_id = ? ORDER BY domain ASC`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("mysql: list tls_certificates: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.TLSCertificate
	for rows.Next() {
		c, err := scanTLSCertificate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (t *tx) UpdateTLSCertificate(ctx context.Context, tenantID, id string, p store.UpdateTLSCertificateParams) (*store.TLSCertificate, error) {
	c, err := t.GetTLSCertificate(ctx, tenantID, id)
	if err != nil {
		return nil, err
	}
	if p.Issuer != nil {
		c.Issuer = *p.Issuer
	}
	if p.Source != nil {
		c.Source = *p.Source
	}
	if p.ExpiresAt != nil {
		c.ExpiresAt = p.ExpiresAt
	}
	if p.AutoRenew != nil {
		c.AutoRenew = *p.AutoRenew
	}
	if p.FingerprintSHA256 != nil {
		c.FingerprintSHA256 = p.FingerprintSHA256
	}
	if p.CertificatePEM != nil {
		c.CertificatePEM = *p.CertificatePEM
	}
	if p.PrivateKeyRef != nil {
		c.PrivateKeyRef = p.PrivateKeyRef
	}
	if _, err := t.sqlTx.ExecContext(ctx,
		`UPDATE tls_certificates SET issuer=?, source=?, expires_at=?, auto_renew=?,
		   fingerprint_sha256=?, certificate_pem=?, private_key_ref=?, updated_at=?
		 WHERE id=? AND tenant_id=?`,
		c.Issuer, c.Source, formatNullableTime(c.ExpiresAt), boolToInt(c.AutoRenew),
		c.FingerprintSHA256, c.CertificatePEM, c.PrivateKeyRef, nowUTC(), id, tenantID); err != nil {
		return nil, fmt.Errorf("mysql: update tls_certificate: %w", err)
	}
	t.emit("tls_certificates", id, "UPDATE")
	return t.GetTLSCertificate(ctx, tenantID, id)
}

func (t *tx) DeleteTLSCertificate(ctx context.Context, tenantID, id string) error {
	res, err := t.sqlTx.ExecContext(ctx, `DELETE FROM tls_certificates WHERE id = ? AND tenant_id = ?`, id, tenantID)
	if err != nil {
		return fmt.Errorf("mysql: delete tls_certificate: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrTLSCertificateNotFound
	}
	t.emit("tls_certificates", id, "DELETE")
	return nil
}

func scanTLSCertificate(s scanner) (*store.TLSCertificate, error) {
	var (
		id, tenantID, domain, issuer, source, certPEM, createdAt, updatedAt string
		expiresAt, fp, keyRef                                               *string
		autoRenew                                                           int
	)
	if err := s.Scan(&id, &tenantID, &domain, &issuer, &source, &expiresAt, &autoRenew,
		&fp, &certPEM, &keyRef, &createdAt, &updatedAt); err != nil {
		return nil, err
	}
	out := &store.TLSCertificate{
		ID: id, TenantID: tenantID, Domain: domain, Issuer: issuer, Source: source,
		AutoRenew: autoRenew == 1, FingerprintSHA256: fp,
		CertificatePEM: certPEM, PrivateKeyRef: keyRef,
		CreatedAt: parseTime(createdAt), UpdatedAt: parseTime(updatedAt),
	}
	if expiresAt != nil {
		ts := parseTime(*expiresAt)
		out.ExpiresAt = &ts
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// TLS Config (singleton)
// ---------------------------------------------------------------------------

func (t *tx) GetTLSConfig(ctx context.Context, tenantID string) (*store.TLSConfig, error) {
	row := t.sqlTx.QueryRowContext(ctx,
		`SELECT tenant_id, acme_provider, acme_email, acme_directory, allowed_ciphers, min_protocol, updated_at
		 FROM tls_configs WHERE tenant_id = ?`, tenantID)
	var (
		tID, acmeProvider, acmeEmail, allowed, minProto, updatedAt string
		acmeDirectory                                              *string
	)
	err := row.Scan(&tID, &acmeProvider, &acmeEmail, &acmeDirectory, &allowed, &minProto, &updatedAt)
	if err == sql.ErrNoRows {
		return &store.TLSConfig{
			TenantID: tenantID, ACMEProvider: "lets-encrypt", AllowedCiphers: "[]",
			MinProtocol: "1.2",
		}, nil
	}
	if err != nil {
		return nil, fmt.Errorf("mysql: get tls_config: %w", err)
	}
	return &store.TLSConfig{
		TenantID: tID, ACMEProvider: acmeProvider, ACMEEmail: acmeEmail,
		ACMEDirectory: acmeDirectory, AllowedCiphers: allowed, MinProtocol: minProto,
		UpdatedAt: parseTime(updatedAt),
	}, nil
}

func (t *tx) UpsertTLSConfig(ctx context.Context, c *store.TLSConfig) (*store.TLSConfig, error) {
	if c == nil || c.TenantID == "" {
		return nil, fmt.Errorf("mysql: tls_config requires tenant_id")
	}
	provider := c.ACMEProvider
	if provider == "" {
		provider = "lets-encrypt"
	}
	allowed := c.AllowedCiphers
	if allowed == "" {
		allowed = "[]"
	}
	minProto := c.MinProtocol
	if minProto == "" {
		minProto = "1.2"
	}
	now := nowUTC()
	_, err := t.sqlTx.ExecContext(ctx,
		`INSERT INTO tls_configs (tenant_id, acme_provider, acme_email, acme_directory, allowed_ciphers, min_protocol, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE acme_provider = VALUES(acme_provider),
		   acme_email = VALUES(acme_email), acme_directory = VALUES(acme_directory),
		   allowed_ciphers = VALUES(allowed_ciphers), min_protocol = VALUES(min_protocol),
		   updated_at = VALUES(updated_at)`,
		c.TenantID, provider, c.ACMEEmail, c.ACMEDirectory, allowed, minProto, now,
	)
	if err != nil {
		return nil, fmt.Errorf("mysql: upsert tls_config: %w", err)
	}
	t.emit("tls_configs", c.TenantID, "UPSERT")
	return t.GetTLSConfig(ctx, c.TenantID)
}
