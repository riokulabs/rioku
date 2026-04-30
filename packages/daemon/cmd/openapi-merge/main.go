// openapi-merge combines the buf-generated swagger files for each
// proto service with hand-written OpenAPI 3.x fragments to produce a
// single canonical OpenAPI document at gen/openapi/rioku/v1/api.full.json.
//
// The buf output covers proto-defined RPCs that are exposed via
// `option (google.api.http)` annotations (config, health, traffic,
// cluster, plugin, build). The bulk of the daemon's REST surface
// lives in hand-written http.Handler functions (auth, audit, sites,
// dashboards, AI, notifications, plugins, PKI, settings, webhooks,
// cluster-tokens, impersonation). Hand-written OpenAPI 3.1 fragments
// under packages/proto/openapi-fragments/ describe those handlers; this
// tool overlays them onto the buf output.
//
// Inputs:
//
//	-base    path to the buf-generated swagger.json (auto-detected
//	         from packages/proto/gen/openapi/rioku/v1/config.swagger.json
//	         when omitted)
//	-fragments
//	         directory of YAML fragments (default
//	         packages/proto/openapi-fragments/)
//	-out     output path (default
//	         packages/proto/gen/openapi/rioku/v1/api.full.json)
//
// Each fragment is a YAML document of the same shape as an OpenAPI 3.x
// document — typically just a `paths:` and/or `components:` map — and
// merges over the base. Conflicts are resolved last-write-wins so the
// fragments can override generated documentation; alphabetical fragment
// ordering keeps the merge deterministic.
//
// The merger does NOT validate against the OpenAPI schema; the
// daemon's CI step pipes the output to a separate validator.
package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

func main() {
	base := flag.String("base", "packages/proto/gen/openapi/rioku/v1/config.swagger.json", "path to the buf-generated base swagger document")
	extras := flag.String("extra-bases", "packages/proto/gen/openapi/rioku/v1/", "directory containing additional *.swagger.json files to merge")
	fragments := flag.String("fragments", "packages/proto/openapi-fragments/", "directory of hand-written OpenAPI YAML fragments")
	out := flag.String("out", "packages/proto/gen/openapi/rioku/v1/api.full.json", "output path for the merged document")
	flag.Parse()

	merged, err := loadJSONDoc(*base)
	if err != nil {
		fail("read base %s: %v", *base, err)
	}

	if *extras != "" {
		entries, err := os.ReadDir(*extras)
		if err == nil {
			for _, e := range entries {
				if e.IsDir() || !strings.HasSuffix(e.Name(), ".swagger.json") {
					continue
				}
				p := filepath.Join(*extras, e.Name())
				if filepath.Clean(p) == filepath.Clean(*base) {
					continue
				}
				doc, err := loadJSONDoc(p)
				if err != nil {
					fail("read swagger %s: %v", p, err)
				}
				deepMerge(merged, doc)
			}
		}
	}

	if *fragments != "" {
		entries, err := os.ReadDir(*fragments)
		if err != nil && !os.IsNotExist(err) {
			fail("read fragments dir %s: %v", *fragments, err)
		}
		var paths []string
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			n := e.Name()
			if strings.HasSuffix(n, ".yaml") || strings.HasSuffix(n, ".yml") || strings.HasSuffix(n, ".json") {
				paths = append(paths, filepath.Join(*fragments, n))
			}
		}
		sort.Strings(paths)
		for _, p := range paths {
			frag, err := loadFragment(p)
			if err != nil {
				fail("read fragment %s: %v", p, err)
			}
			deepMerge(merged, frag)
		}
	}

	raw, err := json.MarshalIndent(merged, "", "  ")
	if err != nil {
		fail("marshal merged: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(*out), 0o755); err != nil {
		fail("mkdir %s: %v", filepath.Dir(*out), err)
	}
	if err := os.WriteFile(*out, raw, 0o644); err != nil {
		fail("write %s: %v", *out, err)
	}
	fmt.Fprintf(os.Stderr, "openapi-merge: wrote %s (%d bytes)\n", *out, len(raw))
}

// loadJSONDoc reads a JSON file into a generic map.
func loadJSONDoc(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc map[string]any
	if err := json.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("decode json: %w", err)
	}
	return doc, nil
}

// loadFragment reads a YAML or JSON fragment and returns it as a
// generic map. yaml.v3 preserves key order via *yaml.Node; we project
// it through json marshalling to get a plain map[string]any so the
// downstream merge logic doesn't have to special-case node trees.
func loadFragment(path string) (map[string]any, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc map[string]any
	if strings.HasSuffix(path, ".json") {
		if err := json.Unmarshal(raw, &doc); err != nil {
			return nil, fmt.Errorf("decode json fragment: %w", err)
		}
		return doc, nil
	}
	if err := yaml.Unmarshal(raw, &doc); err != nil {
		return nil, fmt.Errorf("decode yaml fragment: %w", err)
	}
	return normaliseYAMLMaps(doc).(map[string]any), nil
}

// normaliseYAMLMaps walks a yaml-decoded tree and converts any
// `map[any]any` (yaml.v3's default for nested maps) into
// `map[string]any` so JSON marshalling works.
func normaliseYAMLMaps(v any) any {
	switch t := v.(type) {
	case map[any]any:
		out := make(map[string]any, len(t))
		for k, vv := range t {
			out[fmt.Sprint(k)] = normaliseYAMLMaps(vv)
		}
		return out
	case map[string]any:
		for k, vv := range t {
			t[k] = normaliseYAMLMaps(vv)
		}
		return t
	case []any:
		for i, vv := range t {
			t[i] = normaliseYAMLMaps(vv)
		}
		return t
	default:
		return v
	}
}

// deepMerge recursively merges `src` into `dst`. Maps are merged
// key-by-key; non-map values overwrite. Arrays are replaced (we don't
// concatenate because OpenAPI list fields like `tags` are unordered).
func deepMerge(dst, src map[string]any) {
	for k, v := range src {
		if dv, ok := dst[k]; ok {
			if dm, dok := dv.(map[string]any); dok {
				if sm, sok := v.(map[string]any); sok {
					deepMerge(dm, sm)
					continue
				}
			}
		}
		dst[k] = v
	}
}

func fail(f string, args ...any) {
	fmt.Fprintf(os.Stderr, "openapi-merge: "+f+"\n", args...)
	os.Exit(1)
}
