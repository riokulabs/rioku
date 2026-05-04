package postgres_test

import (
	"encoding/json"
	"reflect"
)

// jsonEqual reports whether two JSON-encoded strings represent the
// same value, ignoring whitespace and key order. Postgres stores
// JSONB and reformats the body on read (alphabetical keys, single
// space after `:`), so byte-for-byte equality fails even when the
// payload round-tripped intact. The audit-payload tests compare
// semantically via this helper.
func jsonEqual(a, b string) bool {
	var av, bv any
	if err := json.Unmarshal([]byte(a), &av); err != nil {
		return false
	}
	if err := json.Unmarshal([]byte(b), &bv); err != nil {
		return false
	}
	return reflect.DeepEqual(av, bv)
}
