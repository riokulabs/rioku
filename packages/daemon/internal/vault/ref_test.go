package vault

import (
	"errors"
	"testing"
)

func TestParse(t *testing.T) {
	tests := []struct {
		name     string
		in       string
		wantErr  error
		wantName string
		wantRes  string
	}{
		{
			name:     "env_simple",
			in:       "{vault://env/OPENAI_API_KEY}",
			wantName: "env",
			wantRes:  "OPENAI_API_KEY",
		},
		{
			name:     "file_absolute_path",
			in:       "{vault://file//etc/rioku/secrets/openai}",
			wantName: "file",
			wantRes:  "/etc/rioku/secrets/openai",
		},
		{
			name:     "op_multi_segment",
			in:       "{vault://op/Personal/OpenAI/api_key}",
			wantName: "op",
			wantRes:  "Personal/OpenAI/api_key",
		},
		{
			name:     "hyphen_underscore_digits_in_backend",
			in:       "{vault://aws-sm_v2/key}",
			wantName: "aws-sm_v2",
			wantRes:  "key",
		},
		{
			name:    "literal_not_reference",
			in:      "sk-abc123",
			wantErr: ErrNotReference,
		},
		{
			name:    "starts_but_not_ends",
			in:      "{vault://env/FOO",
			wantErr: ErrNotReference,
		},
		{
			name:    "ends_but_not_starts",
			in:      "vault://env/FOO}",
			wantErr: ErrNotReference,
		},
		{
			name:    "missing_separator",
			in:      "{vault://envFOO}",
			wantErr: ErrMalformed,
		},
		{
			name:    "empty_backend",
			in:      "{vault:///FOO}",
			wantErr: ErrMalformed,
		},
		{
			name:    "empty_resource",
			in:      "{vault://env/}",
			wantErr: ErrMalformed,
		},
		{
			name:    "backend_starts_with_digit",
			in:      "{vault://9live/foo}",
			wantErr: ErrMalformed,
		},
		{
			name:    "backend_with_invalid_char",
			in:      "{vault://en%v/FOO}",
			wantErr: ErrMalformed,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			r, err := Parse(tt.in)
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("Parse(%q) err = %v, want wrap %v", tt.in, err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("Parse(%q) unexpected err: %v", tt.in, err)
			}
			if r.Backend != tt.wantName {
				t.Errorf("backend = %q, want %q", r.Backend, tt.wantName)
			}
			if r.Resource != tt.wantRes {
				t.Errorf("resource = %q, want %q", r.Resource, tt.wantRes)
			}
			if r.Raw != tt.in {
				t.Errorf("raw = %q, want %q", r.Raw, tt.in)
			}
		})
	}
}

func TestIsReference(t *testing.T) {
	tests := []struct {
		in   string
		want bool
	}{
		{"{vault://env/X}", true},
		{"{vault://}", true},                   // shape match; Parse rejects
		{"prefix{vault://env/X}suffix", false}, // mid-string not allowed in v1
		{"sk-abc", false},
		{"", false},
	}
	for _, tt := range tests {
		if got := IsReference(tt.in); got != tt.want {
			t.Errorf("IsReference(%q) = %v, want %v", tt.in, got, tt.want)
		}
	}
}

func TestMustParse_PanicsOnInvalid(t *testing.T) {
	defer func() {
		if r := recover(); r == nil {
			t.Fatal("MustParse on invalid ref did not panic")
		}
	}()
	_ = MustParse("not a ref")
}
