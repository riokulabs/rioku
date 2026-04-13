package gateway

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/tracestore"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// RegisterTrafficRoutes registers REST endpoints for the traffic analytics
// dashboard. If traceStore is nil (tracing disabled), it returns without
// registering anything.
func RegisterTrafficRoutes(mux *http.ServeMux, engine *config.Engine, traceStore tracestore.Driver) {
	if traceStore == nil {
		return
	}

	mux.Handle("GET /api/v1/traffic/dashboard",
		RequirePermission("traffic:read")(http.HandlerFunc(handleTrafficDashboard(traceStore))))
	mux.Handle("GET /api/v1/traffic/routes/{id}",
		RequirePermission("traffic:read")(http.HandlerFunc(handleTrafficRoute(traceStore))))
	mux.Handle("GET /api/v1/traffic/services/{id}",
		RequirePermission("traffic:read")(http.HandlerFunc(handleTrafficService(traceStore, engine))))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// parseTrafficRange maps a range query string to a total duration and an
// aggregation interval. An empty string defaults to "24h".
func parseTrafficRange(r string) (duration time.Duration, interval time.Duration, err error) {
	if r == "" {
		r = "24h"
	}
	switch r {
	case "1h":
		return 1 * time.Hour, 1 * time.Minute, nil
	case "6h":
		return 6 * time.Hour, 5 * time.Minute, nil
	case "24h":
		return 24 * time.Hour, 15 * time.Minute, nil
	case "7d":
		return 7 * 24 * time.Hour, 1 * time.Hour, nil
	case "30d":
		return 30 * 24 * time.Hour, 6 * time.Hour, nil
	default:
		return 0, 0, fmt.Errorf("unsupported range: %q", r)
	}
}

// reaggregateStatsBuckets groups minute-level StatsBuckets into coarser
// intervals. Within each group it sums counts/bytes and computes
// request-weighted averages for latency percentiles.
func reaggregateStatsBuckets(buckets []tracestore.StatsBucket, interval time.Duration) []tracestore.StatsBucket {
	if len(buckets) == 0 {
		return make([]tracestore.StatsBucket, 0)
	}

	type group struct {
		reqCount  int64
		errCount  int64
		bytesSent int64
		bytesRecv int64
		weightP50 int64 // sum of (reqCount * P50)
		weightP95 int64
		weightP99 int64
	}

	groups := make(map[time.Time]*group)
	for _, b := range buckets {
		key := b.BucketStart.Truncate(interval)
		g, ok := groups[key]
		if !ok {
			g = &group{}
			groups[key] = g
		}
		g.reqCount += b.RequestCount
		g.errCount += b.ErrorCount
		g.bytesSent += b.BytesSent
		g.bytesRecv += b.BytesRecv
		g.weightP50 += b.RequestCount * b.P50LatencyMS
		g.weightP95 += b.RequestCount * b.P95LatencyMS
		g.weightP99 += b.RequestCount * b.P99LatencyMS
	}

	result := make([]tracestore.StatsBucket, 0, len(groups))
	for ts, g := range groups {
		var p50, p95, p99 int64
		if g.reqCount > 0 {
			p50 = g.weightP50 / g.reqCount
			p95 = g.weightP95 / g.reqCount
			p99 = g.weightP99 / g.reqCount
		}
		result = append(result, tracestore.StatsBucket{
			BucketStart:  ts,
			RequestCount: g.reqCount,
			ErrorCount:   g.errCount,
			P50LatencyMS: p50,
			P95LatencyMS: p95,
			P99LatencyMS: p99,
			BytesSent:    g.bytesSent,
			BytesRecv:    g.bytesRecv,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].BucketStart.Before(result[j].BucketStart)
	})
	return result
}

// reaggregateRouteBuckets groups minute-level RouteBuckets into coarser
// intervals keyed by (time, routeID). Sums counts and computes
// request-weighted average latency.
func reaggregateRouteBuckets(buckets []tracestore.RouteBucket, interval time.Duration) []tracestore.RouteBucket {
	if len(buckets) == 0 {
		return make([]tracestore.RouteBucket, 0)
	}

	type key struct {
		ts      time.Time
		routeID string
	}
	type group struct {
		reqCount    int64
		errCount    int64
		weightedLat int64 // sum of (reqCount * AvgLatencyMS)
	}

	groups := make(map[key]*group)
	order := make([]key, 0) // maintain insertion order for deterministic results
	for _, b := range buckets {
		k := key{ts: b.BucketStart.Truncate(interval), routeID: b.RouteID}
		g, ok := groups[k]
		if !ok {
			g = &group{}
			groups[k] = g
			order = append(order, k)
		}
		g.reqCount += b.RequestCount
		g.errCount += b.ErrorCount
		g.weightedLat += b.RequestCount * b.AvgLatencyMS
	}

	result := make([]tracestore.RouteBucket, 0, len(groups))
	for _, k := range order {
		g := groups[k]
		var avgLat int64
		if g.reqCount > 0 {
			avgLat = g.weightedLat / g.reqCount
		}
		result = append(result, tracestore.RouteBucket{
			BucketStart:  k.ts,
			RouteID:      k.routeID,
			RequestCount: g.reqCount,
			ErrorCount:   g.errCount,
			AvgLatencyMS: avgLat,
		})
	}

	sort.Slice(result, func(i, j int) bool {
		if result[i].BucketStart.Equal(result[j].BucketStart) {
			return result[i].RouteID < result[j].RouteID
		}
		return result[i].BucketStart.Before(result[j].BucketStart)
	})
	return result
}

// ---------------------------------------------------------------------------
// Dashboard endpoint: GET /api/v1/traffic/dashboard
// ---------------------------------------------------------------------------

func handleTrafficDashboard(ts tracestore.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		duration, interval, err := parseTrafficRange(r.URL.Query().Get("range"))
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid range", err.Error(), r.URL.Path, nil)
			return
		}

		now := time.Now().UTC()
		since := now.Add(-duration)

		ctx := r.Context()

		statsBuckets, err := ts.GetStatsBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get stats buckets")
			return
		}
		routeBuckets, err := ts.GetRouteBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get route buckets")
			return
		}
		statusBuckets, err := ts.GetStatusBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get status buckets")
			return
		}

		// Re-aggregate stats buckets for time series.
		aggStats := reaggregateStatsBuckets(statsBuckets, interval)

		// --- Stat cards (from raw minute-level buckets) ---
		var totalReq, totalErr int64
		var weightedP50 int64
		activeRoutes := make(map[string]struct{})
		for _, b := range statsBuckets {
			totalReq += b.RequestCount
			totalErr += b.ErrorCount
			weightedP50 += b.RequestCount * b.P50LatencyMS
		}
		for _, b := range routeBuckets {
			activeRoutes[b.RouteID] = struct{}{}
		}

		var avgLatencyMs float64
		var errorRate float64
		if totalReq > 0 {
			avgLatencyMs = float64(weightedP50) / float64(totalReq)
			errorRate = float64(totalErr) / float64(totalReq)
		}
		requestsPerSecond := float64(totalReq) / duration.Seconds()

		statCards := map[string]interface{}{
			"totalRequests":     totalReq,
			"avgLatencyMs":      avgLatencyMs,
			"errorRate":         errorRate,
			"activeRoutes":      len(activeRoutes),
			"requestsPerSecond": requestsPerSecond,
		}

		// --- Top 10 routes by request count ---
		type routeAgg struct {
			routeID      string
			requestCount int64
			errorCount   int64
			weightedLat  int64
		}
		routeMap := make(map[string]*routeAgg)
		for _, b := range routeBuckets {
			ra, ok := routeMap[b.RouteID]
			if !ok {
				ra = &routeAgg{routeID: b.RouteID}
				routeMap[b.RouteID] = ra
			}
			ra.requestCount += b.RequestCount
			ra.errorCount += b.ErrorCount
			ra.weightedLat += b.RequestCount * b.AvgLatencyMS
		}
		routeList := make([]map[string]interface{}, 0, len(routeMap))
		for _, ra := range routeMap {
			var avgLat float64
			if ra.requestCount > 0 {
				avgLat = float64(ra.weightedLat) / float64(ra.requestCount)
			}
			routeList = append(routeList, map[string]interface{}{
				"routeId":      ra.routeID,
				"requestCount": ra.requestCount,
				"errorCount":   ra.errorCount,
				"avgLatencyMs": avgLat,
			})
		}
		sort.Slice(routeList, func(i, j int) bool {
			return routeList[i]["requestCount"].(int64) > routeList[j]["requestCount"].(int64)
		})
		if len(routeList) > 10 {
			routeList = routeList[:10]
		}

		// --- Status distribution ---
		statusDist := map[string]int64{
			"2xx": 0,
			"3xx": 0,
			"4xx": 0,
			"5xx": 0,
		}
		for _, b := range statusBuckets {
			statusDist[b.StatusClass] += b.RequestCount
		}

		// --- Time series ---
		timeSeries := make([]map[string]interface{}, 0, len(aggStats))
		for _, b := range aggStats {
			timeSeries = append(timeSeries, map[string]interface{}{
				"timestamp":    b.BucketStart.Format(time.RFC3339),
				"requests":     b.RequestCount,
				"avgLatencyMs": float64(b.P50LatencyMS),
				"errorCount":   b.ErrorCount,
				"p50LatencyMs": b.P50LatencyMS,
				"p95LatencyMs": b.P95LatencyMS,
				"p99LatencyMs": b.P99LatencyMS,
			})
		}

		resp := map[string]interface{}{
			"statCards":          statCards,
			"timeSeries":         timeSeries,
			"topRoutes":          routeList,
			"statusDistribution": statusDist,
			"range":              r.URL.Query().Get("range"),
		}
		// If no range was specified, report the default.
		if r.URL.Query().Get("range") == "" {
			resp["range"] = "24h"
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// ---------------------------------------------------------------------------
// Per-route endpoint: GET /api/v1/traffic/routes/{id}
// ---------------------------------------------------------------------------

func handleTrafficRoute(ts tracestore.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		routeID := r.PathValue("id")
		if routeID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Missing route ID", "route ID is required", r.URL.Path, nil)
			return
		}

		duration, interval, err := parseTrafficRange(r.URL.Query().Get("range"))
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid range", err.Error(), r.URL.Path, nil)
			return
		}

		now := time.Now().UTC()
		since := now.Add(-duration)
		ctx := r.Context()

		routeBuckets, err := ts.GetRouteBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get route buckets")
			return
		}

		// Filter to this route.
		filtered := make([]tracestore.RouteBucket, 0, len(routeBuckets))
		for _, b := range routeBuckets {
			if b.RouteID == routeID {
				filtered = append(filtered, b)
			}
		}

		// Re-aggregate filtered buckets.
		agg := reaggregateRouteBuckets(filtered, interval)

		// Stat cards from raw filtered buckets.
		var totalReq, totalErr int64
		var weightedLat int64
		for _, b := range filtered {
			totalReq += b.RequestCount
			totalErr += b.ErrorCount
			weightedLat += b.RequestCount * b.AvgLatencyMS
		}

		var avgLatencyMs float64
		if totalReq > 0 {
			avgLatencyMs = float64(weightedLat) / float64(totalReq)
		}

		statCards := map[string]interface{}{
			"totalRequests":     totalReq,
			"avgLatencyMs":      avgLatencyMs,
			"errorCount":        totalErr,
			"requestsPerSecond": float64(totalReq) / duration.Seconds(),
		}

		// Time series from aggregated buckets.
		timeSeries := make([]map[string]interface{}, 0, len(agg))
		for _, b := range agg {
			timeSeries = append(timeSeries, map[string]interface{}{
				"timestamp":    b.BucketStart.Format(time.RFC3339),
				"requests":     b.RequestCount,
				"errorCount":   b.ErrorCount,
				"avgLatencyMs": float64(b.AvgLatencyMS),
			})
		}

		// Simplified status distribution.
		statusDist := map[string]int64{
			"2xx": totalReq - totalErr,
			"4xx": 0,
			"5xx": totalErr,
		}

		rangeStr := r.URL.Query().Get("range")
		if rangeStr == "" {
			rangeStr = "24h"
		}

		resp := map[string]interface{}{
			"routeId":            routeID,
			"statCards":          statCards,
			"timeSeries":         timeSeries,
			"statusDistribution": statusDist,
			"range":              rangeStr,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}

// ---------------------------------------------------------------------------
// Per-service endpoint: GET /api/v1/traffic/services/{id}
// ---------------------------------------------------------------------------

func handleTrafficService(ts tracestore.Driver, engine *config.Engine) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		serviceID := r.PathValue("id")
		if serviceID == "" {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Missing service ID", "service ID is required", r.URL.Path, nil)
			return
		}

		duration, interval, err := parseTrafficRange(r.URL.Query().Get("range"))
		if err != nil {
			writeProblem(w, http.StatusBadRequest, errTypeValidation, "Invalid range", err.Error(), r.URL.Path, nil)
			return
		}

		now := time.Now().UTC()
		since := now.Add(-duration)
		ctx := r.Context()

		// Find routes targeting this service.
		snap, err := engine.GetConfig(ctx)
		if err != nil {
			writeInternalError(w, r, "get config snapshot")
			return
		}

		routeIDSet := make(map[string]struct{})
		routeIDs := make([]string, 0)
		for _, route := range snap.GetRoutes() {
			if t, ok := route.GetTarget().(*riokuv1.Route_ServiceId); ok && t.ServiceId == serviceID {
				routeIDSet[route.GetId()] = struct{}{}
				routeIDs = append(routeIDs, route.GetId())
			}
		}

		// Fetch and filter route buckets.
		routeBuckets, err := ts.GetRouteBuckets(ctx, since, now)
		if err != nil {
			writeInternalError(w, r, "get route buckets")
			return
		}

		filtered := make([]tracestore.RouteBucket, 0, len(routeBuckets))
		for _, b := range routeBuckets {
			if _, ok := routeIDSet[b.RouteID]; ok {
				filtered = append(filtered, b)
			}
		}

		// Re-aggregate filtered buckets.
		agg := reaggregateRouteBuckets(filtered, interval)

		// Collapse across all routes: group time series by timestamp only.
		type tsGroup struct {
			reqCount    int64
			errCount    int64
			weightedLat int64
		}
		tsMap := make(map[time.Time]*tsGroup)
		tsOrder := make([]time.Time, 0)
		for _, b := range agg {
			g, ok := tsMap[b.BucketStart]
			if !ok {
				g = &tsGroup{}
				tsMap[b.BucketStart] = g
				tsOrder = append(tsOrder, b.BucketStart)
			}
			g.reqCount += b.RequestCount
			g.errCount += b.ErrorCount
			g.weightedLat += b.RequestCount * b.AvgLatencyMS
		}
		sort.Slice(tsOrder, func(i, j int) bool {
			return tsOrder[i].Before(tsOrder[j])
		})

		timeSeries := make([]map[string]interface{}, 0, len(tsOrder))
		for _, ts := range tsOrder {
			g := tsMap[ts]
			var avgLat float64
			if g.reqCount > 0 {
				avgLat = float64(g.weightedLat) / float64(g.reqCount)
			}
			timeSeries = append(timeSeries, map[string]interface{}{
				"timestamp":    ts.Format(time.RFC3339),
				"requests":     g.reqCount,
				"errorCount":   g.errCount,
				"avgLatencyMs": avgLat,
			})
		}

		// Stat cards from raw filtered buckets.
		var totalReq, totalErr int64
		var weightedLat int64
		for _, b := range filtered {
			totalReq += b.RequestCount
			totalErr += b.ErrorCount
			weightedLat += b.RequestCount * b.AvgLatencyMS
		}

		var avgLatencyMs float64
		if totalReq > 0 {
			avgLatencyMs = float64(weightedLat) / float64(totalReq)
		}

		statCards := map[string]interface{}{
			"totalRequests":     totalReq,
			"avgLatencyMs":      avgLatencyMs,
			"errorCount":        totalErr,
			"requestsPerSecond": float64(totalReq) / duration.Seconds(),
		}

		rangeStr := r.URL.Query().Get("range")
		if rangeStr == "" {
			rangeStr = "24h"
		}

		resp := map[string]interface{}{
			"serviceId":  serviceID,
			"routeIds":   routeIDs,
			"statCards":  statCards,
			"timeSeries": timeSeries,
			"range":      rangeStr,
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}
}
