package gateway

import (
	"encoding/json"
	"net/http"

	"github.com/riokulabs/rioku/internal/auth"
)

// RegisterAuthRoutes registers the token exchange endpoints on the mux.
func RegisterAuthRoutes(mux *http.ServeMux, a *auth.Auth) {
	mux.HandleFunc("POST /api/v1/auth/token", handleTokenExchange(a))
	mux.HandleFunc("POST /api/v1/auth/refresh", handleTokenRefresh(a))
}

type tokenExchangeRequest struct {
	Token string `json:"token"` // bootstrap token or API key
}

const maxAuthBodySize = 4096 // 4KB is plenty for token exchange

func handleTokenExchange(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req tokenExchangeRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Invalid request body",
				Status:   400,
				Detail:   "Request body must be valid JSON with a 'token' field",
				Instance: r.URL.Path,
			})
			return
		}

		if req.Token == "" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Validation failed",
				Status:   400,
				Detail:   "Token is required",
				Instance: r.URL.Path,
				Errors: []ValidationError{
					{Field: "token", Reason: "must not be empty"},
				},
			})
			return
		}

		// Try as bootstrap token first, then as API key.
		var pair *auth.TokenPair
		var err error

		pair, err = a.ExchangeBootstrapToken(r.Context(), req.Token)
		if err != nil {
			pair, err = a.ValidateAPIKey(r.Context(), req.Token)
		}
		if err != nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeUnauth,
				Title:    "Authentication failed",
				Status:   401,
				Detail:   "The provided token is invalid, expired, or revoked",
				Instance: r.URL.Path,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(pair)
	}
}

type refreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

func handleTokenRefresh(a *auth.Auth) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		var req refreshRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Invalid request body",
				Status:   400,
				Detail:   "Request body must be valid JSON with a 'refresh_token' field",
				Instance: r.URL.Path,
			})
			return
		}

		if req.RefreshToken == "" {
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusBadRequest)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeValidation,
				Title:    "Validation failed",
				Status:   400,
				Detail:   "Refresh token is required",
				Instance: r.URL.Path,
				Errors: []ValidationError{
					{Field: "refresh_token", Reason: "must not be empty"},
				},
			})
			return
		}

		pair, err := a.RefreshTokens(r.Context(), req.RefreshToken)
		if err != nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			w.Header().Set("Content-Type", "application/problem+json")
			w.WriteHeader(http.StatusUnauthorized)
			json.NewEncoder(w).Encode(ProblemDetail{
				Type:     errTypeUnauth,
				Title:    "Refresh failed",
				Status:   401,
				Detail:   "The refresh token is invalid, expired, or has already been used",
				Instance: r.URL.Path,
			})
			return
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		json.NewEncoder(w).Encode(pair)
	}
}
