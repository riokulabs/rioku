package vault

import (
	"reflect"
	"testing"
)

func TestCollectStringMapRefs(t *testing.T) {
	in := map[string]string{
		"authorization": "{vault://env/OTLP_TOKEN}",
		"x-team":        "rioku",
		"x-trace":       "{vault://file//etc/secrets/trace}",
		"x-static":      "literal-value",
	}
	got := CollectStringMapRefs(in)
	want := map[string]string{
		"authorization": "{vault://env/OTLP_TOKEN}",
		"x-trace":       "{vault://file//etc/secrets/trace}",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("CollectStringMapRefs = %v, want %v", got, want)
	}
}

func TestCollectStringMapRefs_NoRefsReturnsNil(t *testing.T) {
	in := map[string]string{"a": "1", "b": "2"}
	if got := CollectStringMapRefs(in); got != nil {
		t.Fatalf("got %v, want nil when no refs are present", got)
	}
}

func TestCollectStringMapRefs_EmptyReturnsNil(t *testing.T) {
	if got := CollectStringMapRefs(nil); got != nil {
		t.Fatalf("got %v, want nil for empty input", got)
	}
}

func TestMaskStringMap(t *testing.T) {
	in := map[string]string{
		"authorization": "{vault://env/X}",
		"x-team":        "rioku",
	}
	got := MaskStringMap(in, "")
	want := map[string]string{
		"authorization": "<masked>",
		"x-team":        "rioku",
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("MaskStringMap = %v, want %v", got, want)
	}

	custom := MaskStringMap(in, "[redacted]")
	if custom["authorization"] != "[redacted]" {
		t.Fatalf("custom placeholder ignored, got %q", custom["authorization"])
	}
}

func TestMaskStringMap_DoesNotMutateInput(t *testing.T) {
	in := map[string]string{"a": "{vault://env/X}"}
	_ = MaskStringMap(in, "")
	if in["a"] != "{vault://env/X}" {
		t.Fatalf("input mutated: %v", in)
	}
}
