package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestDeepMerge_MapsRecurseValuesOverwrite(t *testing.T) {
	dst := map[string]any{
		"openapi": "3.1.0",
		"info":    map[string]any{"title": "Original", "version": "0.1.0"},
		"paths": map[string]any{
			"/keep": map[string]any{"get": map[string]any{"summary": "keep"}},
		},
	}
	src := map[string]any{
		"info":  map[string]any{"title": "Overridden"},
		"paths": map[string]any{"/added": map[string]any{"get": map[string]any{"summary": "added"}}},
	}
	deepMerge(dst, src)

	info := dst["info"].(map[string]any)
	if info["title"] != "Overridden" {
		t.Errorf("info.title = %v, want Overridden", info["title"])
	}
	if info["version"] != "0.1.0" {
		t.Errorf("info.version should be preserved, got %v", info["version"])
	}
	paths := dst["paths"].(map[string]any)
	if _, ok := paths["/keep"]; !ok {
		t.Error("paths./keep should be preserved")
	}
	if _, ok := paths["/added"]; !ok {
		t.Error("paths./added should be added")
	}
}

func TestDeepMerge_NonMapTypesOverwrite(t *testing.T) {
	dst := map[string]any{"servers": []any{"a"}, "x": map[string]any{"k": "v"}}
	src := map[string]any{"servers": []any{"b", "c"}, "x": "scalar"}
	deepMerge(dst, src)

	if got := dst["servers"].([]any); len(got) != 2 || got[0] != "b" {
		t.Errorf("servers should be replaced, got %v", got)
	}
	if dst["x"] != "scalar" {
		t.Errorf("x should be replaced with scalar, got %v", dst["x"])
	}
}

func TestLoadFragment_YAMLToMapStringAny(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "frag.yaml")
	yaml := `
openapi: "3.1.0"
paths:
  /api/v1/things:
    get:
      summary: List things
      responses:
        '200':
          description: ok
`
	if err := os.WriteFile(p, []byte(yaml), 0o644); err != nil {
		t.Fatal(err)
	}
	doc, err := loadFragment(p)
	if err != nil {
		t.Fatalf("loadFragment: %v", err)
	}
	// Round-trip through json marshalling so a map[any]any value
	// would explode loudly. If normaliseYAMLMaps did its job this
	// passes silently.
	if _, err := json.Marshal(doc); err != nil {
		t.Fatalf("json marshal of decoded fragment: %v", err)
	}

	paths := doc["paths"].(map[string]any)
	thing := paths["/api/v1/things"].(map[string]any)
	get := thing["get"].(map[string]any)
	if get["summary"] != "List things" {
		t.Errorf("summary = %v", get["summary"])
	}
}

func TestLoadFragment_JSONFile(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "frag.json")
	if err := os.WriteFile(p, []byte(`{"info":{"title":"From JSON"}}`), 0o644); err != nil {
		t.Fatal(err)
	}
	doc, err := loadFragment(p)
	if err != nil {
		t.Fatalf("loadFragment: %v", err)
	}
	if got := doc["info"].(map[string]any)["title"]; got != "From JSON" {
		t.Errorf("info.title = %v", got)
	}
}

func TestNormaliseYAMLMaps_RecursesIntoArrays(t *testing.T) {
	in := []any{
		map[any]any{"k": "v"},
		map[any]any{"k2": map[any]any{"nested": 1}},
	}
	out := normaliseYAMLMaps(in).([]any)
	if _, err := json.Marshal(out); err != nil {
		t.Fatalf("json marshal: %v", err)
	}
}
