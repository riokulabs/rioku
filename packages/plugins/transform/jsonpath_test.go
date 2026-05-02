package transform

import (
	"encoding/json"
	"reflect"
	"testing"
)

func parseDoc(t *testing.T, src string) any {
	t.Helper()
	var v any
	if err := json.Unmarshal([]byte(src), &v); err != nil {
		t.Fatalf("parse %q: %v", src, err)
	}
	return v
}

func TestJSONPathGet_DotNotation(t *testing.T) {
	doc := parseDoc(t, `{"user":{"name":"alice","age":30}}`)
	v, ok, err := jsonPathGet(doc, "user.name")
	if err != nil || !ok {
		t.Fatalf("get user.name: ok=%v err=%v", ok, err)
	}
	if v != "alice" {
		t.Fatalf("got %v want alice", v)
	}
}

func TestJSONPathGet_ArrayIndex(t *testing.T) {
	doc := parseDoc(t, `{"items":[{"sku":"A"},{"sku":"B"}]}`)
	v, ok, err := jsonPathGet(doc, "items.1.sku")
	if err != nil || !ok {
		t.Fatalf("get items.1.sku: ok=%v err=%v", ok, err)
	}
	if v != "B" {
		t.Fatalf("got %v want B", v)
	}
}

func TestJSONPathGet_MissingPathReturnsFalse(t *testing.T) {
	doc := parseDoc(t, `{"a":1}`)
	cases := []string{"missing", "a.b", "a.0", "items.5.sku"}
	for _, p := range cases {
		t.Run(p, func(t *testing.T) {
			v, ok, err := jsonPathGet(doc, p)
			if err != nil {
				t.Fatalf("err: %v", err)
			}
			if ok {
				t.Fatalf("expected miss, got value=%v", v)
			}
		})
	}
}

func TestJSONPathGet_TypeMismatchReturnsFalse(t *testing.T) {
	doc := parseDoc(t, `{"a":42}`)
	// Asking for a child key of a number should miss, not error.
	if _, ok, err := jsonPathGet(doc, "a.b"); ok || err != nil {
		t.Fatalf("expected miss, got ok=%v err=%v", ok, err)
	}
}

func TestJSONPathSet_SimpleField(t *testing.T) {
	doc := parseDoc(t, `{"a":1}`)
	out, err := jsonPathSet(doc, "b", "hello")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"a":1,"b":"hello"}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathSet_CreatesIntermediateObjects(t *testing.T) {
	doc := parseDoc(t, `{}`)
	out, err := jsonPathSet(doc, "deep.nested.value", float64(7))
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"deep":{"nested":{"value":7}}}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathSet_AppendToArray(t *testing.T) {
	doc := parseDoc(t, `{"items":["A"]}`)
	out, err := jsonPathSet(doc, "items.1", "B")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"items":["A","B"]}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathSet_OverwriteArrayElement(t *testing.T) {
	doc := parseDoc(t, `{"items":["A","B"]}`)
	out, err := jsonPathSet(doc, "items.0", "X")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"items":["X","B"]}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathSet_OutOfRangeIsError(t *testing.T) {
	doc := parseDoc(t, `{"items":["A"]}`)
	if _, err := jsonPathSet(doc, "items.5", "X"); err == nil {
		t.Fatal("expected error for sparse index")
	}
}

func TestJSONPathSet_TypeMismatchIsError(t *testing.T) {
	doc := parseDoc(t, `{"a":42}`)
	if _, err := jsonPathSet(doc, "a.b", "x"); err == nil {
		t.Fatal("expected error setting child of number")
	}
}

func TestJSONPathSet_EmptyPathReplacesRoot(t *testing.T) {
	doc := parseDoc(t, `{"a":1}`)
	out, err := jsonPathSet(doc, "", map[string]any{"new": true})
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"new":true}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathDelete_Field(t *testing.T) {
	doc := parseDoc(t, `{"a":1,"b":2}`)
	out, err := jsonPathDelete(doc, "a")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"b":2}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathDelete_ArrayElement(t *testing.T) {
	doc := parseDoc(t, `{"items":["A","B","C"]}`)
	out, err := jsonPathDelete(doc, "items.1")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"items":["A","C"]}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathDelete_MissingPathIsNoop(t *testing.T) {
	doc := parseDoc(t, `{"a":1}`)
	out, err := jsonPathDelete(doc, "missing.deep")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"a":1}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathRename_MovesValue(t *testing.T) {
	doc := parseDoc(t, `{"oldKey":"value","keep":1}`)
	out, err := jsonPathRename(doc, "oldKey", "newKey")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"keep":1,"newKey":"value"}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathRename_NestedSourceToTopLevel(t *testing.T) {
	doc := parseDoc(t, `{"user":{"email":"x@y.z","name":"x"}}`)
	out, err := jsonPathRename(doc, "user.email", "primary_email")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"primary_email":"x@y.z","user":{"name":"x"}}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathRename_MissingSourceIsNoop(t *testing.T) {
	doc := parseDoc(t, `{"a":1}`)
	out, err := jsonPathRename(doc, "missing", "elsewhere")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"a":1}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathCopy_DuplicatesValue(t *testing.T) {
	doc := parseDoc(t, `{"src":"value"}`)
	out, err := jsonPathCopy(doc, "src", "dst")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"dst":"value","src":"value"}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestJSONPathCopy_MissingSourceIsNoop(t *testing.T) {
	doc := parseDoc(t, `{"a":1}`)
	out, err := jsonPathCopy(doc, "missing", "dst")
	if err != nil {
		t.Fatal(err)
	}
	got := mustJSON(t, out)
	want := `{"a":1}`
	if got != want {
		t.Fatalf("got %s want %s", got, want)
	}
}

func TestSplitPath_DropsEmptySegments(t *testing.T) {
	cases := []struct {
		in   string
		want []string
	}{
		{"a.b.c", []string{"a", "b", "c"}},
		{"a..b", []string{"a", "b"}},
		{"", []string{}},
		{".", []string{}},
		{"items.0", []string{"items", "0"}},
	}
	for _, tc := range cases {
		got := splitPath(tc.in)
		if !reflect.DeepEqual(got, tc.want) {
			t.Errorf("splitPath(%q) = %v, want %v", tc.in, got, tc.want)
		}
	}
}

func TestParseIndex_Boundaries(t *testing.T) {
	cases := []struct {
		in    string
		idx   int
		isIdx bool
	}{
		{"0", 0, true},
		{"7", 7, true},
		{"100", 100, true},
		{"007", 0, false}, // leading zero — treat as object key
		{"-1", 0, false},
		{"name", 0, false},
		{"", 0, false},
	}
	for _, tc := range cases {
		gotIdx, gotIsIdx := parseIndex(tc.in)
		if gotIsIdx != tc.isIdx || (tc.isIdx && gotIdx != tc.idx) {
			t.Errorf("parseIndex(%q) = (%d,%v), want (%d,%v)", tc.in, gotIdx, gotIsIdx, tc.idx, tc.isIdx)
		}
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(b)
}
