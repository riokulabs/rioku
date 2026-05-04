package store

import (
	"encoding/json"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// MarshalMatchersJSON encodes a slice of route matchers as a JSON array of
// protojson-encoded objects suitable for storage in a TEXT/JSONB column.
// All three dialect implementations (sqlite, postgres, mysql) share this
// helper so the on-disk JSON shape stays identical across backends.
func MarshalMatchersJSON(matchers []*riokuv1.Matcher) (string, error) {
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

// UnmarshalMatchersJSON decodes a JSON array of protojson-encoded matchers
// previously written by MarshalMatchersJSON.
func UnmarshalMatchersJSON(s string) ([]*riokuv1.Matcher, error) {
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
