package vault

// CollectStringMapRefs extracts a `$refs` sidecar from a flat
// map[string]string. The sidecar mirrors the input shape: every key
// that holds a vault reference appears in the sidecar with the
// reference string verbatim; literals are omitted.
//
// Used by admin REST handlers that return secret-bearing fields
// shaped as a map (e.g., OTLP Headers, request_headers, response
// header policies). Callers should attach the sidecar under a
// `$refs` JSON key alongside the resolved-or-literal value.
//
// Per D12 the admin REST surface never returns plaintext for
// referenced fields. Callers are expected to either return the
// reference strings themselves on the value side, or to return a
// constant placeholder; the sidecar is what lets the admin UI know
// which keys the placeholder applies to.
func CollectStringMapRefs(values map[string]string) map[string]string {
	if len(values) == 0 {
		return nil
	}
	out := make(map[string]string)
	for k, v := range values {
		if IsReference(v) {
			out[k] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// MaskStringMap returns a copy of values with every vault-reference
// entry replaced by the given placeholder. Pair with
// CollectStringMapRefs on the admin REST response so the resolved
// plaintext never leaves the daemon.
//
// placeholder is typically "<masked>" or "[redacted]" — pick one
// and keep it consistent across the REST surface so the admin UI
// can recognise it. Empty placeholder defaults to "<masked>".
func MaskStringMap(values map[string]string, placeholder string) map[string]string {
	if placeholder == "" {
		placeholder = "<masked>"
	}
	out := make(map[string]string, len(values))
	for k, v := range values {
		if IsReference(v) {
			out[k] = placeholder
			continue
		}
		out[k] = v
	}
	return out
}
