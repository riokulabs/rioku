package gateway

import (
	"net/http"
)

// RegisterPromQLRoutes registers the (currently stub) PromQL query proxy.
// Plan 8 (Dashboards) replaces this stub with a real Prometheus-proxying
// handler. Until then it returns RFC-7807 501 so the SPA's dashboard
// widgets render the "PromQL not yet wired" empty state.
func RegisterPromQLRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/v1/t/{tenant}/promql/query",
		RequirePermission("metrics:read")(http.HandlerFunc(handlePromQLStub)))
}

func handlePromQLStub(w http.ResponseWriter, r *http.Request) {
	writeProblem(w,
		http.StatusNotImplemented,
		"https://rioku.dev/errors/not-implemented",
		"PromQL proxy not yet implemented",
		"This endpoint will be implemented in Plan 8 (Dashboards). The dashboard query layer "+
			"is currently fed by stub data; live Prometheus queries land with the dashboard wiring.",
		r.URL.Path,
		nil,
	)
}
