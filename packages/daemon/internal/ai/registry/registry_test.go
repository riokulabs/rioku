package registry

import (
	"errors"
	"math"
	"testing"
)

func TestNew_LoadsBootstrapJSON(t *testing.T) {
	r, err := New()
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	if got := r.Count(); got < 5 {
		t.Errorf("Count() = %d, want at least 5 bootstrap entries", got)
	}
}

func TestRegistry_GetAndLookup(t *testing.T) {
	r, _ := New()
	m, err := r.Get("gpt-4o")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if m.LiteLLMProvider != "openai" {
		t.Errorf("provider = %q", m.LiteLLMProvider)
	}
	if m.InputCostPerToken == nil || *m.InputCostPerToken <= 0 {
		t.Errorf("InputCostPerToken = %v", m.InputCostPerToken)
	}

	if got := r.Lookup("gpt-4o"); got == nil {
		t.Error("Lookup returned nil for known model")
	}
	if got := r.Lookup("never-going-to-exist"); got != nil {
		t.Errorf("Lookup of unknown returned %v, want nil", got)
	}
}

func TestRegistry_GetUnknownReturnsSentinel(t *testing.T) {
	r, _ := New()
	_, err := r.Get("nope")
	if !errors.Is(err, ErrModelNotFound) {
		t.Fatalf("err = %v, want wrap ErrModelNotFound", err)
	}
}

func TestRegistry_ByProvider(t *testing.T) {
	r, _ := New()
	openai := r.ByProvider("openai")
	if len(openai) == 0 {
		t.Fatal("expected at least one openai model in bootstrap")
	}
	for _, m := range openai {
		if m.LiteLLMProvider != "openai" {
			t.Errorf("got provider %q in openai filter", m.LiteLLMProvider)
		}
	}
	if r.ByProvider("never-going-to-exist") != nil {
		t.Error("ByProvider on unknown should return nil")
	}
}

func TestRegistry_All_Sorted(t *testing.T) {
	r, _ := New()
	all := r.All()
	for i := 1; i < len(all); i++ {
		if all[i-1].ID >= all[i].ID {
			t.Fatalf("All not sorted: %q before %q", all[i-1].ID, all[i].ID)
		}
	}
}

func TestRegistry_OverlayShadowsAndAdds(t *testing.T) {
	r, _ := New()

	overlay := []byte(`{
		"gpt-4o": {
			"input_cost_per_token": 0.0001,
			"litellm_provider": "openai",
			"deprecated": "internal pricing override"
		},
		"private-llama-7b": {
			"max_tokens": 4096,
			"input_cost_per_token": 0,
			"output_cost_per_token": 0,
			"litellm_provider": "custom",
			"mode": "chat"
		}
	}`)

	if err := r.LoadOverlay(overlay); err != nil {
		t.Fatalf("LoadOverlay: %v", err)
	}

	// Shadowed entry: deprecated note + overridden cost.
	got, _ := r.Get("gpt-4o")
	if got.Deprecated != "internal pricing override" {
		t.Errorf("Deprecated = %q", got.Deprecated)
	}
	if !got.RiokuOverlay {
		t.Error("RiokuOverlay = false on shadowed entry")
	}
	if got.InputCostPerToken == nil || *got.InputCostPerToken != 0.0001 {
		t.Errorf("cost = %v, want 0.0001", got.InputCostPerToken)
	}

	// Newly-introduced entry.
	custom, err := r.Get("private-llama-7b")
	if err != nil {
		t.Fatal(err)
	}
	if !custom.RiokuOverlay {
		t.Error("private-llama-7b RiokuOverlay = false")
	}
}

func TestCalculateRequestCost(t *testing.T) {
	r, _ := New()

	// gpt-4o: 0.0000025 input, 0.00001 output.
	cost, err := r.CalculateRequestCost("gpt-4o", 1000, 500)
	if err != nil {
		t.Fatal(err)
	}
	want := 1000*0.0000025 + 500*0.00001
	if math.Abs(cost-want) > 1e-9 {
		t.Errorf("cost = %v, want %v", cost, want)
	}
}

func TestCalculateRequestCost_UnknownModel(t *testing.T) {
	r, _ := New()
	_, err := r.CalculateRequestCost("nope", 100, 100)
	if !errors.Is(err, ErrModelNotFound) {
		t.Fatalf("err = %v", err)
	}
}

func TestCalculateRequestCostWithCache(t *testing.T) {
	r, _ := New()

	// claude-3-5-sonnet has cache rates set explicitly.
	cost, err := r.CalculateRequestCostWithCache("claude-3-5-sonnet-20241022",
		1000, 500, 200, 800)
	if err != nil {
		t.Fatal(err)
	}

	// 1000 * 0.000003 + 500 * 0.000015 + 200 * 0.00000375 + 800 * 0.0000003
	want := 1000*0.000003 + 500*0.000015 + 200*0.00000375 + 800*0.0000003
	if math.Abs(cost-want) > 1e-9 {
		t.Errorf("cost = %v, want %v", cost, want)
	}
}

func TestFormatCost(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{0, "0.000000"},
		{0.000001, "0.000001"},
		{1.234567, "1.234567"},
	}
	for _, tc := range cases {
		if got := FormatCost(tc.in); got != tc.want {
			t.Errorf("FormatCost(%v) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
