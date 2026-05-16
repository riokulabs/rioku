package postgres

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/riokulabs/rioku/internal/store"
)

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

func (t *tx) CreatePlan(ctx context.Context, params store.CreatePlanParams) (*store.Plan, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = params.TenantID
	}

	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO plans (id, tenant_id, api_id, name, description,
		     security_type, validation, rate_limit_per_minute,
		     quota_per_day, selection_rule, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
		params.ID, tenantID, params.APIID, params.Name, params.Description,
		string(params.SecurityType), string(params.Validation),
		params.RateLimitPerMinute, params.QuotaPerDay, params.SelectionRule,
		now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrPlanNameTaken
		}
		return nil, fmt.Errorf("postgres: create plan: %w", err)
	}
	t.emit("plans", params.ID, "INSERT")
	return t.GetPlan(ctx, params.ID)
}

const planSelectColumns = `id, tenant_id, api_id, name, description,
	security_type, validation, status, rate_limit_per_minute,
	quota_per_day, selection_rule, created_at, updated_at`

func scanPlan(row scanner) (*store.Plan, error) {
	var (
		p                                      store.Plan
		securityType, validation, status string
		createdAt, updatedAt             sql.NullTime
	)
	if err := row.Scan(
		&p.ID, &p.TenantID, &p.APIID, &p.Name, &p.Description,
		&securityType, &validation, &status, &p.RateLimitPerMinute,
		&p.QuotaPerDay, &p.SelectionRule, &createdAt, &updatedAt,
	); err != nil {
		return nil, err
	}
	p.SecurityType = store.PlanSecurityType(securityType)
	p.Validation = store.PlanValidation(validation)
	p.Status = store.PlanStatus(status)
	if createdAt.Valid {
		p.CreatedAt = createdAt.Time.UTC()
	}
	if updatedAt.Valid {
		p.UpdatedAt = updatedAt.Time.UTC()
	}
	return &p, nil
}

func (t *tx) GetPlan(ctx context.Context, id string) (*store.Plan, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT `+planSelectColumns+` FROM plans WHERE id = ? AND tenant_id = ?`),
		id, tenantID,
	)
	p, err := scanPlan(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrPlanNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get plan: %w", err)
	}
	return p, nil
}

func (t *tx) ListPlans(ctx context.Context) ([]*store.Plan, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+planSelectColumns+` FROM plans WHERE tenant_id = ? ORDER BY name`),
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list plans: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Plan
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, fmt.Errorf("postgres: scan plan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) ListPlansByAPI(ctx context.Context, apiID string) ([]*store.Plan, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+planSelectColumns+` FROM plans WHERE tenant_id = ? AND api_id = ? ORDER BY name`),
		tenantID, apiID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list plans by api: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Plan
	for rows.Next() {
		p, err := scanPlan(rows)
		if err != nil {
			return nil, fmt.Errorf("postgres: scan plan: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

func (t *tx) UpdatePlan(ctx context.Context, id string, params store.UpdatePlanParams) (*store.Plan, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)

	sets := []string{}
	args := []any{}
	if params.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *params.Name)
	}
	if params.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *params.Description)
	}
	if params.SecurityType != nil {
		sets = append(sets, "security_type = ?")
		args = append(args, string(*params.SecurityType))
	}
	if params.Validation != nil {
		sets = append(sets, "validation = ?")
		args = append(args, string(*params.Validation))
	}
	if params.RateLimitPerMinute != nil {
		sets = append(sets, "rate_limit_per_minute = ?")
		args = append(args, *params.RateLimitPerMinute)
	}
	if params.QuotaPerDay != nil {
		sets = append(sets, "quota_per_day = ?")
		args = append(args, *params.QuotaPerDay)
	}
	if params.SelectionRule != nil {
		sets = append(sets, "selection_rule = ?")
		args = append(args, *params.SelectionRule)
	}
	if len(sets) == 0 {
		return t.GetPlan(ctx, id)
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, now, id, tenantID)

	q := rewritePlaceholders(`UPDATE plans SET ` + strings.Join(sets, ", ") + ` WHERE id = ? AND tenant_id = ?`)
	res, err := t.sqlTx.ExecContext(ctx, q, args...)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrPlanNameTaken
		}
		return nil, fmt.Errorf("postgres: update plan: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.ErrPlanNotFound
	}
	t.emit("plans", id, "UPDATE")
	return t.GetPlan(ctx, id)
}

func (t *tx) TransitionPlan(ctx context.Context, id string, to store.PlanStatus) (*store.Plan, error) {
	current, err := t.GetPlan(ctx, id)
	if err != nil {
		return nil, err
	}
	if !store.ValidPlanTransition(current.Status, to) {
		return nil, fmt.Errorf("%w: %s → %s", store.ErrPlanInvalidTransition, current.Status, to)
	}
	tenantID := store.TenantIDFromContext(ctx)
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE plans SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
		string(to), nowUTC(), id, tenantID,
	); err != nil {
		return nil, fmt.Errorf("postgres: transition plan: %w", err)
	}
	t.emit("plans", id, "UPDATE")
	return t.GetPlan(ctx, id)
}

func (t *tx) DeletePlan(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM plans WHERE id = ? AND tenant_id = ?`),
		id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("postgres: delete plan: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrPlanNotFound
	}
	t.emit("plans", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

func (t *tx) CreateApplication(ctx context.Context, params store.CreateApplicationParams) (*store.Application, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = params.TenantID
	}
	var owner sql.NullString
	if params.OwnerUserID != nil {
		owner = sql.NullString{String: *params.OwnerUserID, Valid: true}
	}

	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO applications (id, tenant_id, name, description, owner_user_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`),
		params.ID, tenantID, params.Name, params.Description, owner, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrApplicationNameTaken
		}
		return nil, fmt.Errorf("postgres: create application: %w", err)
	}
	t.emit("applications", params.ID, "INSERT")
	return t.GetApplication(ctx, params.ID)
}

const appSelectColumns = `id, tenant_id, name, description, owner_user_id, status, created_at, updated_at`

func scanApplication(row scanner) (*store.Application, error) {
	var (
		a                  store.Application
		owner              sql.NullString
		status             string
		createdAt, updatedAt sql.NullTime
	)
	if err := row.Scan(
		&a.ID, &a.TenantID, &a.Name, &a.Description,
		&owner, &status, &createdAt, &updatedAt,
	); err != nil {
		return nil, err
	}
	if owner.Valid {
		s := owner.String
		a.OwnerUserID = &s
	}
	a.Status = store.ApplicationStatus(status)
	if createdAt.Valid {
		a.CreatedAt = createdAt.Time.UTC()
	}
	if updatedAt.Valid {
		a.UpdatedAt = updatedAt.Time.UTC()
	}
	return &a, nil
}

func (t *tx) GetApplication(ctx context.Context, id string) (*store.Application, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT `+appSelectColumns+` FROM applications WHERE id = ? AND tenant_id = ?`),
		id, tenantID,
	)
	a, err := scanApplication(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrApplicationNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get application: %w", err)
	}
	return a, nil
}

func (t *tx) ListApplications(ctx context.Context) ([]*store.Application, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+appSelectColumns+` FROM applications WHERE tenant_id = ? ORDER BY name`),
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list applications: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Application
	for rows.Next() {
		a, err := scanApplication(rows)
		if err != nil {
			return nil, fmt.Errorf("postgres: scan application: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (t *tx) UpdateApplication(ctx context.Context, id string, params store.UpdateApplicationParams) (*store.Application, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)

	sets := []string{}
	args := []any{}
	if params.Name != nil {
		sets = append(sets, "name = ?")
		args = append(args, *params.Name)
	}
	if params.Description != nil {
		sets = append(sets, "description = ?")
		args = append(args, *params.Description)
	}
	if params.SetOwnerNil {
		sets = append(sets, "owner_user_id = NULL")
	} else if params.OwnerUserID != nil {
		sets = append(sets, "owner_user_id = ?")
		args = append(args, *params.OwnerUserID)
	}
	if len(sets) == 0 {
		return t.GetApplication(ctx, id)
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, now, id, tenantID)

	q := rewritePlaceholders(`UPDATE applications SET ` + strings.Join(sets, ", ") + ` WHERE id = ? AND tenant_id = ?`)
	res, err := t.sqlTx.ExecContext(ctx, q, args...)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrApplicationNameTaken
		}
		return nil, fmt.Errorf("postgres: update application: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.ErrApplicationNotFound
	}
	t.emit("applications", id, "UPDATE")
	return t.GetApplication(ctx, id)
}

func (t *tx) TransitionApplication(ctx context.Context, id string, to store.ApplicationStatus) (*store.Application, error) {
	current, err := t.GetApplication(ctx, id)
	if err != nil {
		return nil, err
	}
	if !store.ValidApplicationTransition(current.Status, to) {
		return nil, fmt.Errorf("%w: %s → %s", store.ErrApplicationInvalidTransition, current.Status, to)
	}
	tenantID := store.TenantIDFromContext(ctx)
	if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`UPDATE applications SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
		string(to), nowUTC(), id, tenantID,
	); err != nil {
		return nil, fmt.Errorf("postgres: transition application: %w", err)
	}
	// Closing an application cascades child subscriptions to closed.
	if to == store.ApplicationStatusClosed {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE subscriptions SET status = 'closed', updated_at = ?
			 WHERE application_id = ? AND tenant_id = ?
			   AND status IN ('pending', 'accepted', 'paused')`),
			nowUTC(), id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("postgres: cascade subscriptions on app close: %w", err)
		}
	}
	t.emit("applications", id, "UPDATE")
	return t.GetApplication(ctx, id)
}

func (t *tx) DeleteApplication(ctx context.Context, id string) error {
	tenantID := store.TenantIDFromContext(ctx)
	res, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`DELETE FROM applications WHERE id = ? AND tenant_id = ?`),
		id, tenantID,
	)
	if err != nil {
		return fmt.Errorf("postgres: delete application: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return store.ErrApplicationNotFound
	}
	t.emit("applications", id, "DELETE")
	return nil
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

func (t *tx) CreateSubscription(ctx context.Context, params store.CreateSubscriptionParams) (*store.Subscription, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)
	if tenantID == "" {
		tenantID = params.TenantID
	}

	_, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
		`INSERT INTO subscriptions (id, tenant_id, plan_id, application_id, api_id,
		     request_message, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`),
		params.ID, tenantID, params.PlanID, params.ApplicationID, params.APIID,
		params.RequestMessage, now, now,
	)
	if err != nil {
		if isPgUniqueViolation(err, "") {
			return nil, store.ErrSubscriptionDuplicate
		}
		return nil, fmt.Errorf("postgres: create subscription: %w", err)
	}
	t.emit("subscriptions", params.ID, "INSERT")
	return t.GetSubscription(ctx, params.ID)
}

const subSelectColumns = `id, tenant_id, plan_id, application_id, api_id, status,
	request_message, reason_message, starting_at, ending_at, created_at, updated_at`

func scanSubscription(row scanner) (*store.Subscription, error) {
	var (
		s                    store.Subscription
		status               string
		startingAt, endingAt sql.NullTime
		createdAt, updatedAt sql.NullTime
	)
	if err := row.Scan(
		&s.ID, &s.TenantID, &s.PlanID, &s.ApplicationID, &s.APIID,
		&status, &s.RequestMessage, &s.ReasonMessage,
		&startingAt, &endingAt, &createdAt, &updatedAt,
	); err != nil {
		return nil, err
	}
	s.Status = store.SubscriptionStatus(status)
	if startingAt.Valid {
		t := startingAt.Time.UTC()
		s.StartingAt = &t
	}
	if endingAt.Valid {
		t := endingAt.Time.UTC()
		s.EndingAt = &t
	}
	if createdAt.Valid {
		s.CreatedAt = createdAt.Time.UTC()
	}
	if updatedAt.Valid {
		s.UpdatedAt = updatedAt.Time.UTC()
	}
	return &s, nil
}

func (t *tx) GetSubscription(ctx context.Context, id string) (*store.Subscription, error) {
	tenantID := store.TenantIDFromContext(ctx)
	row := t.sqlTx.QueryRowContext(ctx, rewritePlaceholders(
		`SELECT `+subSelectColumns+` FROM subscriptions WHERE id = ? AND tenant_id = ?`),
		id, tenantID,
	)
	s, err := scanSubscription(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, store.ErrSubscriptionNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("postgres: get subscription: %w", err)
	}
	return s, nil
}

func (t *tx) ListSubscriptions(ctx context.Context) ([]*store.Subscription, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+subSelectColumns+` FROM subscriptions WHERE tenant_id = ? ORDER BY created_at DESC`),
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list subscriptions: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Subscription
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, fmt.Errorf("postgres: scan subscription: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *tx) ListSubscriptionsByApplication(ctx context.Context, applicationID string) ([]*store.Subscription, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+subSelectColumns+` FROM subscriptions WHERE tenant_id = ? AND application_id = ? ORDER BY created_at DESC`),
		tenantID, applicationID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list subscriptions by app: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Subscription
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, fmt.Errorf("postgres: scan subscription: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *tx) ListSubscriptionsByPlan(ctx context.Context, planID string) ([]*store.Subscription, error) {
	tenantID := store.TenantIDFromContext(ctx)
	rows, err := t.sqlTx.QueryContext(ctx, rewritePlaceholders(
		`SELECT `+subSelectColumns+` FROM subscriptions WHERE tenant_id = ? AND plan_id = ? ORDER BY created_at DESC`),
		tenantID, planID,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: list subscriptions by plan: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var out []*store.Subscription
	for rows.Next() {
		s, err := scanSubscription(rows)
		if err != nil {
			return nil, fmt.Errorf("postgres: scan subscription: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

func (t *tx) UpdateSubscription(ctx context.Context, id string, params store.UpdateSubscriptionParams) (*store.Subscription, error) {
	now := nowUTC()
	tenantID := store.TenantIDFromContext(ctx)

	sets := []string{}
	args := []any{}
	if params.RequestMessage != nil {
		sets = append(sets, "request_message = ?")
		args = append(args, *params.RequestMessage)
	}
	if params.ReasonMessage != nil {
		sets = append(sets, "reason_message = ?")
		args = append(args, *params.ReasonMessage)
	}
	if params.ClearStartingAt {
		sets = append(sets, "starting_at = NULL")
	} else if params.StartingAt != nil {
		sets = append(sets, "starting_at = ?")
		args = append(args, params.StartingAt.UTC())
	}
	if params.ClearEndingAt {
		sets = append(sets, "ending_at = NULL")
	} else if params.EndingAt != nil {
		sets = append(sets, "ending_at = ?")
		args = append(args, params.EndingAt.UTC())
	}
	if len(sets) == 0 {
		return t.GetSubscription(ctx, id)
	}
	sets = append(sets, "updated_at = ?")
	args = append(args, now, id, tenantID)

	q := rewritePlaceholders(`UPDATE subscriptions SET ` + strings.Join(sets, ", ") + ` WHERE id = ? AND tenant_id = ?`)
	res, err := t.sqlTx.ExecContext(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("postgres: update subscription: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return nil, store.ErrSubscriptionNotFound
	}
	t.emit("subscriptions", id, "UPDATE")
	return t.GetSubscription(ctx, id)
}

func (t *tx) TransitionSubscription(ctx context.Context, id string, to store.SubscriptionStatus, reason string) (*store.Subscription, error) {
	current, err := t.GetSubscription(ctx, id)
	if err != nil {
		return nil, err
	}
	if !store.ValidSubscriptionTransition(current.Status, to) {
		return nil, fmt.Errorf("%w: %s → %s", store.ErrSubscriptionInvalidTransition, current.Status, to)
	}
	tenantID := store.TenantIDFromContext(ctx)
	now := nowUTC()
	if reason == "" {
		// Don't clobber a previous reason on a no-reason transition.
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE subscriptions SET status = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
			string(to), now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("postgres: transition subscription: %w", err)
		}
	} else {
		if _, err := t.sqlTx.ExecContext(ctx, rewritePlaceholders(
			`UPDATE subscriptions SET status = ?, reason_message = ?, updated_at = ? WHERE id = ? AND tenant_id = ?`),
			string(to), reason, now, id, tenantID,
		); err != nil {
			return nil, fmt.Errorf("postgres: transition subscription: %w", err)
		}
	}
	t.emit("subscriptions", id, "UPDATE")
	return t.GetSubscription(ctx, id)
}
