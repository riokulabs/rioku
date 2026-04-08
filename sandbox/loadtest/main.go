// Package main implements a standalone load testing binary for measuring
// the overhead of proxying requests through Rioku versus hitting upstream
// services directly.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"math"
	"net/http"
	"os"
	"runtime"
	"runtime/pprof"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// Profile defines a load test profile loaded from JSON.
type Profile struct {
	Name        string        `json:"name"`
	TargetRPS   int           `json:"target_rps"`
	Duration    Duration      `json:"duration"`
	Concurrency int           `json:"concurrency"`
	Routes      []RouteTarget `json:"routes"`
	// Spike mode: ramp up to SpikeRPS then back down.
	SpikeRPS int      `json:"spike_rps,omitempty"`
	SpikeAt  Duration `json:"spike_at,omitempty"`
	SpikeDur Duration `json:"spike_duration,omitempty"`
	// Config change test: trigger config mutation at this offset.
	ConfigChangeAt Duration `json:"config_change_at,omitempty"`
}

// RouteTarget defines a single route to test.
type RouteTarget struct {
	Name       string `json:"name"`
	DirectURL  string `json:"direct_url"`
	ProxiedURL string `json:"proxied_url"`
	Host       string `json:"host"`
	Weight     int    `json:"weight"` // relative weight for request distribution
}

// Duration wraps time.Duration for JSON unmarshaling from string.
type Duration struct {
	time.Duration
}

func (d *Duration) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	dur, err := time.ParseDuration(s)
	if err != nil {
		return err
	}
	d.Duration = dur
	return nil
}

func (d Duration) MarshalJSON() ([]byte, error) {
	return json.Marshal(d.Duration.String())
}

// RouteResult holds latency stats for a single route.
type RouteResult struct {
	RPS      int     `json:"rps"`
	P50Ms    float64 `json:"p50_ms"`
	P95Ms    float64 `json:"p95_ms"`
	P99Ms    float64 `json:"p99_ms"`
	P999Ms   float64 `json:"p999_ms"`
	Errors   int64   `json:"errors"`
	Requests int64   `json:"requests"`
}

// OverheadResult shows the delta between direct and proxied.
type OverheadResult struct {
	P50DeltaMs float64 `json:"p50_delta_ms"`
	P99DeltaMs float64 `json:"p99_delta_ms"`
}

// ResourceStats holds runtime resource measurements.
type ResourceStats struct {
	PeakHeapMB          float64 `json:"peak_heap_mb"`
	GoroutinesStart     int     `json:"goroutines_start"`
	GoroutinesEnd       int     `json:"goroutines_end"`
	GCPauseP99Ms        float64 `json:"gc_pause_p99_ms"`
	HeapGrowthRateKBSec float64 `json:"heap_growth_rate_kb_per_sec"`
}

// FullResult is the output format written to stdout.
type FullResult struct {
	Profile   string                     `json:"profile"`
	Direct    map[string]*RouteResult    `json:"direct,omitempty"`
	Proxied   map[string]*RouteResult    `json:"proxied,omitempty"`
	Overhead  map[string]*OverheadResult `json:"overhead,omitempty"`
	Resources *ResourceStats             `json:"resources,omitempty"`
}

func main() {
	profilePath := flag.String("profile", "", "path to profile JSON")
	mode := flag.String("mode", "both", "direct, proxied, or both")
	monitor := flag.Bool("monitor", false, "capture runtime.MemStats snapshots")
	pprofFlag := flag.Bool("pprof", false, "write pprof heap/goroutine profiles")
	outputPath := flag.String("output", "", "write results to file (default: stdout)")
	flag.Parse()

	if *profilePath == "" {
		fmt.Fprintln(os.Stderr, "usage: loadtest --profile <path.json> [--mode direct|proxied|both] [--monitor] [--pprof]")
		os.Exit(1)
	}

	profileData, err := os.ReadFile(*profilePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "read profile: %v\n", err)
		os.Exit(1)
	}

	var profile Profile
	if err := json.Unmarshal(profileData, &profile); err != nil {
		fmt.Fprintf(os.Stderr, "parse profile: %v\n", err)
		os.Exit(1)
	}

	result := &FullResult{Profile: profile.Name}

	// Pprof: capture start profiles.
	if *pprofFlag {
		writeProfile("goroutine-start.prof", "goroutine")
		writeHeapProfile("heap-start.prof")
	}

	// Monitor: capture MemStats in background.
	var resourceStats *ResourceStats
	var monitorCancel context.CancelFunc
	if *monitor {
		var monitorCtx context.Context
		monitorCtx, monitorCancel = context.WithCancel(context.Background())
		resourceStats = startMonitor(monitorCtx)
	}

	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			MaxIdleConns:        profile.Concurrency * 2,
			MaxIdleConnsPerHost: profile.Concurrency,
			IdleConnTimeout:     90 * time.Second,
		},
	}

	if *mode == "direct" || *mode == "both" {
		fmt.Fprintln(os.Stderr, "Running direct mode...")
		result.Direct = runLoad(client, profile, "direct")
	}
	if *mode == "proxied" || *mode == "both" {
		fmt.Fprintln(os.Stderr, "Running proxied mode...")
		result.Proxied = runLoad(client, profile, "proxied")
	}

	// Compute overhead if both modes were run.
	if result.Direct != nil && result.Proxied != nil {
		result.Overhead = make(map[string]*OverheadResult)
		for name, proxied := range result.Proxied {
			if direct, ok := result.Direct[name]; ok {
				result.Overhead[name] = &OverheadResult{
					P50DeltaMs: proxied.P50Ms - direct.P50Ms,
					P99DeltaMs: proxied.P99Ms - direct.P99Ms,
				}
			}
		}
	}

	// Stop monitor and capture final stats.
	if *monitor && monitorCancel != nil {
		monitorCancel()
		time.Sleep(100 * time.Millisecond) // let goroutine finish
		resourceStats.GoroutinesEnd = runtime.NumGoroutine()
		result.Resources = resourceStats
	}

	// Pprof: capture end profiles.
	if *pprofFlag {
		writeProfile("goroutine-end.prof", "goroutine")
		writeHeapProfile("heap-end.prof")
	}

	// Output results.
	out, _ := json.MarshalIndent(result, "", "  ")
	if *outputPath != "" {
		if err := os.WriteFile(*outputPath, out, 0644); err != nil {
			fmt.Fprintf(os.Stderr, "write output: %v\n", err)
			os.Exit(1)
		}
		fmt.Fprintf(os.Stderr, "Results written to %s\n", *outputPath)
	} else {
		fmt.Println(string(out))
	}
}

// runLoad executes the load test for a given mode and returns per-route results.
func runLoad(client *http.Client, profile Profile, mode string) map[string]*RouteResult {
	duration := profile.Duration.Duration
	concurrency := profile.Concurrency
	targetRPS := profile.TargetRPS

	// Build weighted route distribution.
	var weightedRoutes []RouteTarget
	for _, rt := range profile.Routes {
		w := rt.Weight
		if w <= 0 {
			w = 1
		}
		for j := 0; j < w; j++ {
			weightedRoutes = append(weightedRoutes, rt)
		}
	}

	// Collect latencies per route.
	type sample struct {
		route   string
		latency time.Duration
		isError bool
	}
	samples := make(chan sample, targetRPS*int(duration.Seconds()))

	// Rate limiter: one tick per request at target RPS.
	interval := time.Second / time.Duration(targetRPS)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	ctx, cancel := context.WithTimeout(context.Background(), duration)
	defer cancel()

	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)
	var reqCount atomic.Int64

	go func() {
		routeIdx := 0
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				rt := weightedRoutes[routeIdx%len(weightedRoutes)]
				routeIdx++

				sem <- struct{}{}
				wg.Add(1)
				go func(rt RouteTarget) {
					defer func() { <-sem; wg.Done() }()

					var url string
					if mode == "direct" {
						url = rt.DirectURL
					} else {
						url = rt.ProxiedURL
					}

					req, _ := http.NewRequestWithContext(ctx, "GET", url, nil)
					if rt.Host != "" && mode == "proxied" {
						req.Host = rt.Host
					}

					start := time.Now()
					resp, err := client.Do(req)
					elapsed := time.Since(start)

					isErr := err != nil
					if resp != nil {
						io.Copy(io.Discard, resp.Body)
						resp.Body.Close()
						if resp.StatusCode >= 500 {
							isErr = true
						}
					}

					samples <- sample{route: rt.Name, latency: elapsed, isError: isErr}
					reqCount.Add(1)
				}(rt)
			}
		}
	}()

	<-ctx.Done()
	wg.Wait()
	close(samples)

	// Aggregate per-route.
	type routeData struct {
		latencies []time.Duration
		errors    int64
	}
	byRoute := make(map[string]*routeData)
	for s := range samples {
		rd, ok := byRoute[s.route]
		if !ok {
			rd = &routeData{}
			byRoute[s.route] = rd
		}
		rd.latencies = append(rd.latencies, s.latency)
		if s.isError {
			rd.errors++
		}
	}

	results := make(map[string]*RouteResult)
	for name, rd := range byRoute {
		sort.Slice(rd.latencies, func(i, j int) bool { return rd.latencies[i] < rd.latencies[j] })
		n := len(rd.latencies)
		durationSecs := int(duration.Seconds())
		if durationSecs == 0 {
			durationSecs = 1
		}
		results[name] = &RouteResult{
			RPS:      n / durationSecs,
			P50Ms:    percentileMs(rd.latencies, 0.50),
			P95Ms:    percentileMs(rd.latencies, 0.95),
			P99Ms:    percentileMs(rd.latencies, 0.99),
			P999Ms:   percentileMs(rd.latencies, 0.999),
			Errors:   rd.errors,
			Requests: int64(n),
		}
	}
	return results
}

func percentileMs(sorted []time.Duration, p float64) float64 {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(float64(len(sorted))*p)) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return float64(sorted[idx].Microseconds()) / 1000.0
}

// startMonitor captures MemStats snapshots every 5 seconds and returns
// the ResourceStats struct (populated on cancel).
func startMonitor(ctx context.Context) *ResourceStats {
	stats := &ResourceStats{
		GoroutinesStart: runtime.NumGoroutine(),
	}
	var peakHeap uint64
	var heapSamples []float64
	var sampleTimes []float64
	startTime := time.Now()

	go func() {
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		var ms runtime.MemStats
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runtime.ReadMemStats(&ms)
				if ms.HeapAlloc > peakHeap {
					peakHeap = ms.HeapAlloc
				}
				heapSamples = append(heapSamples, float64(ms.HeapAlloc)/1024.0) // KB
				sampleTimes = append(sampleTimes, time.Since(startTime).Seconds())

				// GC pause p99.
				pauses := ms.PauseNs[:ms.NumGC%256]
				if len(pauses) > 0 {
					sorted := make([]uint64, len(pauses))
					copy(sorted, pauses)
					sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
					p99Idx := int(float64(len(sorted)) * 0.99)
					if p99Idx >= len(sorted) {
						p99Idx = len(sorted) - 1
					}
					stats.GCPauseP99Ms = float64(sorted[p99Idx]) / 1e6
				}
			}
		}
	}()

	// Compute final stats when context is cancelled.
	go func() {
		<-ctx.Done()
		stats.PeakHeapMB = float64(peakHeap) / (1024 * 1024)

		// Linear regression for heap growth rate.
		if len(heapSamples) >= 3 {
			stats.HeapGrowthRateKBSec = linearSlope(sampleTimes, heapSamples)
		}
	}()

	return stats
}

// linearSlope computes the slope of a simple linear regression (y = mx + b).
func linearSlope(x, y []float64) float64 {
	n := float64(len(x))
	if n < 2 {
		return 0
	}
	var sumX, sumY, sumXY, sumX2 float64
	for i := range x {
		sumX += x[i]
		sumY += y[i]
		sumXY += x[i] * y[i]
		sumX2 += x[i] * x[i]
	}
	denom := n*sumX2 - sumX*sumX
	if denom == 0 {
		return 0
	}
	return (n*sumXY - sumX*sumY) / denom
}

func writeProfile(filename, profileName string) {
	f, err := os.Create("sandbox/loadtest/" + filename)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create %s: %v\n", filename, err)
		return
	}
	defer f.Close()
	p := pprof.Lookup(profileName)
	if p != nil {
		p.WriteTo(f, 0)
	}
}

func writeHeapProfile(filename string) {
	f, err := os.Create("sandbox/loadtest/" + filename)
	if err != nil {
		fmt.Fprintf(os.Stderr, "create %s: %v\n", filename, err)
		return
	}
	defer f.Close()
	runtime.GC() // force GC before heap profile for accuracy
	pprof.WriteHeapProfile(f)
}
