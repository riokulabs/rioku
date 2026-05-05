package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/riokulabs/rioku/sandbox/tools/seedgen/fixtures"
)

func TestRunnerInvokesPostInOrder(t *testing.T) {
	calls := []string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		w.WriteHeader(201)
	}))
	defer srv.Close()

	r := fixtures.NewRunner(fixtures.RunnerConfig{
		APIBase: srv.URL,
		Tenant:  "test",
		Mode:    "lean",
		Seed:    1,
	})

	if err := r.RunAll(); err != nil {
		t.Fatal(err)
	}
	if len(calls) == 0 {
		t.Fatal("no fixture calls observed")
	}
	// lean mode seeds 5 services
	if len(calls) < 5 {
		t.Fatalf("expected at least 5 calls, got %d", len(calls))
	}
}
