package sqlite

import (
	"encoding/json"
	"fmt"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/structpb"
)

// ---------------------------------------------------------------------------
// JSON marshaling helpers
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
// sourceType is "" for static upstreams, "srv" for SrvLookup, "a" for ALookup.
// sourceJSON is the protojson encoding of the source message, or "{}" when unset.
func marshalUpstreamSourceJSON(u *riokuv1.Upstream) (string, string, error) {
	switch src := u.GetSource().(type) {
	case *riokuv1.Upstream_SrvLookup:
		j, err := marshalSrvLookupJSON(src.SrvLookup)
		if err != nil {
			return "", "", err
		}
		return "srv", j, nil
	case *riokuv1.Upstream_ALookup:
		j, err := marshalALookupJSON(src.ALookup)
		if err != nil {
			return "", "", err
		}
		return "a", j, nil
	default:
		return "", "{}", nil
	}
}

// unmarshalUpstreamSource sets the Source oneof on u from the stored
// (sourceType, sourceJSON) pair. Unrecognised sourceType values are ignored
// (treated as static) for forward-compatibility.
func unmarshalUpstreamSource(u *riokuv1.Upstream, sourceType, sourceJSON string) error {
	switch sourceType {
	case "srv":
		srv, err := unmarshalSrvLookupJSON(sourceJSON)
		if err != nil {
			return err
		}
		if srv != nil {
			u.Source = &riokuv1.Upstream_SrvLookup{SrvLookup: srv}
		}
	case "a":
		al, err := unmarshalALookupJSON(sourceJSON)
		if err != nil {
			return err
		}
		if al != nil {
			u.Source = &riokuv1.Upstream_ALookup{ALookup: al}
		}
	}
	return nil
}

// marshalSrvLookupJSON encodes a SrvLookup proto as a JSON string.
func marshalSrvLookupJSON(srv *riokuv1.SrvLookup) (string, error) {
	if srv == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(srv)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// unmarshalSrvLookupJSON decodes a JSON string into a SrvLookup proto.
func unmarshalSrvLookupJSON(s string) (*riokuv1.SrvLookup, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	srv := &riokuv1.SrvLookup{}
	if err := protojson.Unmarshal([]byte(s), srv); err != nil {
		return nil, err
	}
	return srv, nil
}

// marshalALookupJSON encodes an ALookup proto as a JSON string.
func marshalALookupJSON(al *riokuv1.ALookup) (string, error) {
	if al == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(al)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// unmarshalALookupJSON decodes a JSON string into an ALookup proto.
func unmarshalALookupJSON(s string) (*riokuv1.ALookup, error) {
	if s == "" || s == "{}" {
		return nil, nil
	}
	al := &riokuv1.ALookup{}
	if err := protojson.Unmarshal([]byte(s), al); err != nil {
		return nil, err
	}
	return al, nil
}

// marshalTrustedProxiesJSON encodes a TrustedProxies proto as a JSON string.
func marshalTrustedProxiesJSON(tp *riokuv1.TrustedProxies) (string, error) {
	if tp == nil {
		return "{}", nil
	}
	b, err := protojson.Marshal(tp)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// unmarshalTrustedProxiesJSON decodes a JSON string into a TrustedProxies proto.
//
// Backward-compat shim: the legacy storage format was a JSON array of CIDR
// strings (e.g. ["10.0.0.0/8"]). When the value parses as a JSON array we
// wrap it as TrustedProxies{Static: [...]} so existing rows continue to work
// without a data migration.
func unmarshalTrustedProxiesJSON(s string) (*riokuv1.TrustedProxies, error) {
	if s == "" || s == "{}" || s == "[]" {
		return nil, nil
	}
	// Try the new object shape first.
	if len(s) > 0 && s[0] == '{' {
		tp := &riokuv1.TrustedProxies{}
		if err := protojson.Unmarshal([]byte(s), tp); err != nil {
			return nil, err
		}
		return tp, nil
	}
	// Legacy shape: JSON array of strings → wrap as static CIDRs.
	var ranges []string
	if err := json.Unmarshal([]byte(s), &ranges); err != nil {
		return nil, fmt.Errorf("sqlite: parse trusted_proxies legacy array: %w", err)
	}
	return &riokuv1.TrustedProxies{Static: ranges}, nil
}
