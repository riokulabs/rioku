package transform

import (
	"fmt"
	"strconv"
	"strings"
)

// jsonPathSet writes value at path in doc, creating intermediate
// objects as needed. Returns the (possibly mutated) root, since
// setting at the empty path replaces the root entirely.
//
// Path semantics:
//   - "" replaces the root with value.
//   - Each '.'-separated segment is either an object key or an
//     integer array index. Indices that point at the next slot
//     past the current length append; indices beyond that fail.
//   - Missing intermediate object keys are created as map[string]any.
//   - Missing intermediate slots in an array fail (we won't pad
//     with nil — better to error than to silently corrupt shape).
func jsonPathSet(doc any, path string, value any) (any, error) {
	if path == "" {
		return value, nil
	}
	segments := splitPath(path)
	return setRecursive(doc, segments, value)
}

func setRecursive(node any, segments []string, value any) (any, error) {
	if len(segments) == 0 {
		return value, nil
	}
	head, tail := segments[0], segments[1:]

	if idx, ok := parseIndex(head); ok {
		arr, ok := node.([]any)
		if !ok {
			if node == nil {
				return nil, fmt.Errorf("expected array at segment %q, got nil", head)
			}
			return nil, fmt.Errorf("expected array at segment %q, got %T", head, node)
		}
		if idx < 0 {
			return nil, fmt.Errorf("negative index %d at segment %q", idx, head)
		}
		switch {
		case idx < len(arr):
			child, err := setRecursive(arr[idx], tail, value)
			if err != nil {
				return nil, err
			}
			arr[idx] = child
		case idx == len(arr):
			// Append a fresh slot. The remaining tail's first
			// segment dictates the slot's container type.
			var seed any
			if len(tail) == 0 {
				seed = value
			} else {
				seed = newContainer(tail[0])
				child, err := setRecursive(seed, tail, value)
				if err != nil {
					return nil, err
				}
				seed = child
			}
			arr = append(arr, seed)
		default:
			return nil, fmt.Errorf("index %d out of range (len=%d)", idx, len(arr))
		}
		return arr, nil
	}

	// Object key path.
	obj, ok := node.(map[string]any)
	if !ok {
		if node == nil {
			obj = map[string]any{}
		} else {
			return nil, fmt.Errorf("expected object at segment %q, got %T", head, node)
		}
	}
	existing := obj[head]
	if existing == nil && len(tail) > 0 {
		existing = newContainer(tail[0])
	}
	child, err := setRecursive(existing, tail, value)
	if err != nil {
		return nil, err
	}
	obj[head] = child
	return obj, nil
}

// jsonPathGet returns (value, true) when the path resolves and
// (nil, false) when any segment is missing or has the wrong shape.
// Errors are reserved for genuinely malformed paths (e.g. negative
// index) — type mismatches return false so callers can treat them
// as "not present".
func jsonPathGet(doc any, path string) (any, bool, error) {
	if path == "" {
		return doc, true, nil
	}
	segments := splitPath(path)
	cur := doc
	for _, seg := range segments {
		if idx, ok := parseIndex(seg); ok {
			arr, ok := cur.([]any)
			if !ok {
				return nil, false, nil
			}
			if idx < 0 {
				return nil, false, fmt.Errorf("negative index %d at segment %q", idx, seg)
			}
			if idx >= len(arr) {
				return nil, false, nil
			}
			cur = arr[idx]
			continue
		}
		obj, ok := cur.(map[string]any)
		if !ok {
			return nil, false, nil
		}
		v, ok := obj[seg]
		if !ok {
			return nil, false, nil
		}
		cur = v
	}
	return cur, true, nil
}

// jsonPathDelete removes the value at path. Missing paths are a
// silent no-op so deletes are idempotent. Type mismatches likewise
// no-op.
func jsonPathDelete(doc any, path string) (any, error) {
	if path == "" {
		return nil, nil
	}
	segments := splitPath(path)
	return deleteRecursive(doc, segments)
}

func deleteRecursive(node any, segments []string) (any, error) {
	if len(segments) == 0 {
		return nil, nil
	}
	head, tail := segments[0], segments[1:]

	if idx, ok := parseIndex(head); ok {
		arr, ok := node.([]any)
		if !ok {
			return node, nil
		}
		if idx < 0 || idx >= len(arr) {
			return arr, nil
		}
		if len(tail) == 0 {
			return append(arr[:idx], arr[idx+1:]...), nil
		}
		child, err := deleteRecursive(arr[idx], tail)
		if err != nil {
			return nil, err
		}
		arr[idx] = child
		return arr, nil
	}

	obj, ok := node.(map[string]any)
	if !ok {
		return node, nil
	}
	existing, ok := obj[head]
	if !ok {
		return obj, nil
	}
	if len(tail) == 0 {
		delete(obj, head)
		return obj, nil
	}
	child, err := deleteRecursive(existing, tail)
	if err != nil {
		return nil, err
	}
	obj[head] = child
	return obj, nil
}

// jsonPathRename moves the value at `from` to `to` and removes the
// source. Missing source is a no-op (consistent with delete).
func jsonPathRename(doc any, from, to string) (any, error) {
	v, ok, err := jsonPathGet(doc, from)
	if err != nil {
		return nil, err
	}
	if !ok {
		return doc, nil
	}
	doc, err = jsonPathDelete(doc, from)
	if err != nil {
		return nil, err
	}
	return jsonPathSet(doc, to, v)
}

// jsonPathCopy duplicates the value at `from` to `to`. The source
// is left intact. Missing source is a no-op.
func jsonPathCopy(doc any, from, to string) (any, error) {
	v, ok, err := jsonPathGet(doc, from)
	if err != nil {
		return nil, err
	}
	if !ok {
		return doc, nil
	}
	return jsonPathSet(doc, to, v)
}

// splitPath splits a dot-separated path into segments. Empty
// segments (e.g. from "a..b") are dropped.
func splitPath(path string) []string {
	parts := strings.Split(path, ".")
	out := parts[:0]
	for _, p := range parts {
		if p == "" {
			continue
		}
		out = append(out, p)
	}
	return out
}

// parseIndex returns (n, true) when seg is a non-negative integer
// literal, (-1, false) otherwise. We deliberately do not accept
// leading zeros except for "0" itself, to avoid ambiguity with
// numeric-looking object keys like "007".
func parseIndex(seg string) (int, bool) {
	if seg == "" {
		return 0, false
	}
	if len(seg) > 1 && seg[0] == '0' {
		return 0, false
	}
	n, err := strconv.Atoi(seg)
	if err != nil || n < 0 {
		return 0, false
	}
	return n, true
}

// newContainer returns the empty container appropriate for the
// next segment: an array if the segment is an integer index,
// otherwise an object.
func newContainer(nextSegment string) any {
	if _, ok := parseIndex(nextSegment); ok {
		return []any{}
	}
	return map[string]any{}
}
