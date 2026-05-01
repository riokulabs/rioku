package mysql

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

const timeFormat = "2006-01-02T15:04:05.000Z"

// newID generates a UUID string for use as a primary key.
func newID() string {
	return uuid.New().String()
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

	matchers, err := unmarshalMatchersJSON(matchersJSON)
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
	)
	if err := s.Scan(&id, &name, &lbPolicy, &hcJSON, &labelsJSON, &createdAt, &updatedAt,
		&dialTimeoutSeconds, &responseHeaderTimeoutSeconds, &idleTimeoutSeconds,
		&phcJSON, &rpJSON, &utJSON, &cpJSON, &lbCookieName, &lbHeaderName); err != nil {
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

func marshalMatchersJSON(matchers []*riokuv1.Matcher) (string, error) {
	if matchers == nil {
		return "[]", nil
	}
	var arr []json.RawMessage
	for _, m := range matchers {
		b, err := protojson.Marshal(m)
		if err != nil {
			return "", err
		}
		arr = append(arr, b)
	}
	out, err := json.Marshal(arr)
	return string(out), err
}

func unmarshalMatchersJSON(s string) ([]*riokuv1.Matcher, error) {
	var arr []json.RawMessage
	if err := json.Unmarshal([]byte(s), &arr); err != nil {
		return nil, err
	}
	matchers := make([]*riokuv1.Matcher, 0, len(arr))
	for _, raw := range arr {
		m := &riokuv1.Matcher{}
		if err := protojson.Unmarshal(raw, m); err != nil {
			return nil, err
		}
		matchers = append(matchers, m)
	}
	return matchers, nil
}

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
