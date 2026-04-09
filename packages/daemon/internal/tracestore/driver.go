package tracestore

import (
	"context"
	"fmt"
	"sync"
	"time"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// DriverConfig holds connection parameters for opening a trace store.
type DriverConfig struct {
	// Driver selects the backend: "sqlite", "postgres", or "mysql".
	Driver string
	// Path is the file path for SQLite databases.
	Path string
	// DSN is the connection string for networked backends.
	DSN string
	// MaxSizeGB caps the on-disk size of the trace store. When nil, no limit
	// is enforced (beyond the underlying filesystem).
	MaxSizeGB *float64
}

// SamplingConfig controls which traces are persisted to the store.
type SamplingConfig struct {
	// Rate is the fraction of requests to sample (0.0–1.0).
	Rate float64
	// ErrorsAlways forces all error responses to be recorded regardless of Rate.
	ErrorsAlways bool
	// AIAlways forces all AI/LLM traces to be recorded regardless of Rate.
	AIAlways bool
	// SlowThresholdMS forces recording of any request whose duration exceeds
	// this threshold (in milliseconds). Zero disables threshold sampling.
	SlowThresholdMS int
}

// ---------------------------------------------------------------------------
// Bucket types
// ---------------------------------------------------------------------------

// StatsBucket holds pre-aggregated global request statistics for a single
// time bucket (typically one minute).
type StatsBucket struct {
	BucketStart  time.Time
	RequestCount int64
	ErrorCount   int64
	// P50LatencyMS is the 50th-percentile request duration in milliseconds.
	P50LatencyMS int64
	// P95LatencyMS is the 95th-percentile request duration in milliseconds.
	P95LatencyMS int64
	// P99LatencyMS is the 99th-percentile request duration in milliseconds.
	P99LatencyMS int64
	BytesSent    int64
	BytesRecv    int64
}

// RouteBucket holds per-route request statistics for a single time bucket.
type RouteBucket struct {
	BucketStart  time.Time
	RouteID      string
	RequestCount int64
	ErrorCount   int64
	AvgLatencyMS int64
}

// StatusBucket holds request counts grouped by HTTP status class for a single
// time bucket. StatusClass is a string such as "2xx", "4xx", or "5xx".
type StatusBucket struct {
	BucketStart  time.Time
	StatusClass  string
	RequestCount int64
}

// ModelBucket holds per-model AI usage statistics for a single time bucket.
type ModelBucket struct {
	BucketStart      time.Time
	Provider         string
	Model            string
	RequestCount     int64
	TotalTokens      int64
	EstimatedCostUSD float64
}

// SessionSummary holds a rolled-up view of an agent session.
type SessionSummary struct {
	SessionID        string
	AgentID          string
	AgentName        string
	TurnCount        int64
	TotalTokens      int64
	EstimatedCostUSD float64
	Active           bool
	StartedAt        time.Time
	LastSeenAt       time.Time
}

// ---------------------------------------------------------------------------
// Driver interface
// ---------------------------------------------------------------------------

// Driver is the trace store abstraction. Concrete implementations live in
// sub-packages (e.g. sqlite).
type Driver interface {
	// Open initialises the backend using the supplied configuration.
	Open(ctx context.Context, cfg DriverConfig) error
	// Close releases all resources held by the backend.
	Close() error

	// WriteBatch persists a slice of request traces atomically.
	WriteBatch(ctx context.Context, traces []*riokuv1.RequestTrace) error

	// WriteStatsBucket persists a pre-aggregated global stats bucket.
	WriteStatsBucket(ctx context.Context, b StatsBucket) error
	// WriteRouteBucket persists a pre-aggregated per-route stats bucket.
	WriteRouteBucket(ctx context.Context, b RouteBucket) error
	// WriteStatusBucket persists a pre-aggregated per-status-class bucket.
	WriteStatusBucket(ctx context.Context, b StatusBucket) error
	// WriteModelBucket persists a pre-aggregated per-model AI usage bucket.
	WriteModelBucket(ctx context.Context, b ModelBucket) error

	// QueryTraces returns traces matching the query along with the total
	// matching count (before pagination).
	QueryTraces(ctx context.Context, q *riokuv1.TraceQuery) ([]*riokuv1.RequestTrace, int64, error)
	// GetTrace returns a single trace by its trace ID.
	GetTrace(ctx context.Context, traceID string) (*riokuv1.RequestTrace, error)

	// GetStatsBuckets returns global stats buckets in the given time range.
	GetStatsBuckets(ctx context.Context, since, until time.Time) ([]StatsBucket, error)
	// GetRouteBuckets returns per-route stats buckets in the given time range.
	GetRouteBuckets(ctx context.Context, since, until time.Time) ([]RouteBucket, error)
	// GetStatusBuckets returns per-status-class buckets in the given time range.
	GetStatusBuckets(ctx context.Context, since, until time.Time) ([]StatusBucket, error)
	// GetModelBuckets returns per-model AI usage buckets in the given time range.
	GetModelBuckets(ctx context.Context, since, until time.Time) ([]ModelBucket, error)

	// GetSessionTraces returns all request traces belonging to an agent session.
	GetSessionTraces(ctx context.Context, sessionID string) ([]*riokuv1.RequestTrace, error)
	// ListSessions returns a paginated list of agent session summaries. When
	// activeOnly is true only sessions with recent activity are returned.
	ListSessions(ctx context.Context, activeOnly bool, since time.Time, limit, offset int) ([]SessionSummary, int64, error)

	// Prune deletes old data according to retention settings.
	// rawRetention controls how long individual traces are kept.
	// aggRetention controls how long aggregated bucket rows are kept.
	// aiRetention controls how long AI-specific traces are kept.
	// Returns the number of rows deleted.
	Prune(ctx context.Context, rawRetention, aggRetention, aiRetention time.Duration) (int64, error)
}

// ---------------------------------------------------------------------------
// Driver registration
// ---------------------------------------------------------------------------

var (
	driversMu sync.RWMutex
	drivers   = map[string]func() Driver{}
)

// Register makes a driver factory available by name.
// It is intended to be called from init() in driver sub-packages.
func Register(name string, factory func() Driver) {
	driversMu.Lock()
	defer driversMu.Unlock()
	drivers[name] = factory
}

// New creates a Driver by name. Returns an error if the driver is not registered.
func New(name string) (Driver, error) {
	driversMu.RLock()
	factory, ok := drivers[name]
	driversMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("unknown tracestore driver: %q", name)
	}
	return factory(), nil
}
