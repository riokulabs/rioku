package auth

import (
	"testing"
)

func TestValidateKeyScopes(t *testing.T) {
	tests := []struct {
		name       string
		requested  []string
		userScopes []string
		wantErr    bool
	}{
		{
			name:       "exact match single scope",
			requested:  []string{"config:read"},
			userScopes: []string{"config:read"},
			wantErr:    false,
		},
		{
			name:       "exact match multiple scopes",
			requested:  []string{"config:read", "config:write"},
			userScopes: []string{"config:read", "config:write", "keys:own"},
			wantErr:    false,
		},
		{
			name:       "wildcard star covers everything",
			requested:  []string{"config:read", "admin", "keys:manage"},
			userScopes: []string{"*"},
			wantErr:    false,
		},
		{
			name:       "category wildcard covers sub-scopes",
			requested:  []string{"config:read"},
			userScopes: []string{"config:*"},
			wantErr:    false,
		},
		{
			name:       "category wildcard covers multiple sub-scopes",
			requested:  []string{"config:read", "config:write"},
			userScopes: []string{"config:*"},
			wantErr:    false,
		},
		{
			name:       "category wildcard does not cover different category",
			requested:  []string{"keys:manage"},
			userScopes: []string{"config:*"},
			wantErr:    true,
		},
		{
			name:       "escalation blocked - requesting admin with limited scopes",
			requested:  []string{"admin"},
			userScopes: []string{"config:read"},
			wantErr:    true,
		},
		{
			name:       "partial escalation blocked - one scope ok one not",
			requested:  []string{"config:read", "admin"},
			userScopes: []string{"config:read"},
			wantErr:    true,
		},
		{
			name:       "empty requested list passes",
			requested:  []string{},
			userScopes: []string{"config:read"},
			wantErr:    false,
		},
		{
			name:       "nil requested list passes",
			requested:  nil,
			userScopes: []string{"config:read"},
			wantErr:    false,
		},
		{
			name:       "empty user scopes blocks everything",
			requested:  []string{"config:read"},
			userScopes: []string{},
			wantErr:    true,
		},
		{
			name:       "mixed exact and wildcard user scopes",
			requested:  []string{"config:read", "keys:own"},
			userScopes: []string{"config:*", "keys:own"},
			wantErr:    false,
		},
		{
			name:       "wildcard does not match partial prefix",
			requested:  []string{"configurations:read"},
			userScopes: []string{"config:*"},
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateKeyScopes(tt.requested, tt.userScopes)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateKeyScopes() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}
