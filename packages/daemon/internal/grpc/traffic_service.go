package grpc

import (
	"context"
	"strconv"
	"time"

	"github.com/riokulabs/rioku/internal/tracestore"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type trafficService struct {
	riokuv1.UnimplementedTrafficServiceServer
	buf   *tracestore.RingBuffer
	store tracestore.Driver
}

func newTrafficService(buf *tracestore.RingBuffer, store tracestore.Driver) *trafficService {
	return &trafficService{buf: buf, store: store}
}

// WatchTraffic streams live request traces from the ring buffer, applying
// optional filters from the request.
func (s *trafficService) WatchTraffic(req *riokuv1.WatchTrafficRequest, stream grpc.ServerStreamingServer[riokuv1.RequestTrace]) error {
	ch, unsub := s.buf.Subscribe(256)
	defer unsub()

	ctx := stream.Context()

	// Pre-compute filter sets for O(1) lookups.
	routeSet := make(map[string]struct{}, len(req.GetRouteIds()))
	for _, r := range req.GetRouteIds() {
		routeSet[r] = struct{}{}
	}
	statusSet := make(map[int32]struct{}, len(req.GetStatusCodes()))
	for _, sc := range req.GetStatusCodes() {
		statusSet[sc] = struct{}{}
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case trace, ok := <-ch:
			if !ok {
				return nil
			}
			if !matchesWatchFilter(trace, routeSet, statusSet, req.GetAiOnly(), req.GetMinDurationMs()) {
				continue
			}
			if err := stream.Send(trace); err != nil {
				return err
			}
		}
	}
}

// matchesWatchFilter returns true if the trace passes all active filters.
func matchesWatchFilter(trace *riokuv1.RequestTrace, routeSet map[string]struct{}, statusSet map[int32]struct{}, aiOnly bool, minDurationMs int64) bool {
	if len(routeSet) > 0 {
		if _, ok := routeSet[trace.GetRouteId()]; !ok {
			return false
		}
	}
	if len(statusSet) > 0 {
		if _, ok := statusSet[trace.GetStatusCode()]; !ok {
			return false
		}
	}
	if aiOnly && trace.GetAi() == nil {
		return false
	}
	if minDurationMs > 0 && trace.GetDurationMs() < minDurationMs {
		return false
	}
	return true
}

// QueryTraces returns traces matching the query with pagination.
func (s *trafficService) QueryTraces(ctx context.Context, req *riokuv1.TraceQuery) (*riokuv1.TraceQueryResult, error) {
	traces, total, err := s.store.QueryTraces(ctx, req)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "query traces: %v", err)
	}

	// Compute next page token if there are more results.
	var nextPageToken string
	pageSize := int32(50)
	offset := int32(0)
	if p := req.GetPage(); p != nil {
		if p.GetPageSize() > 0 {
			pageSize = p.GetPageSize()
		}
		if tok := p.GetPageToken(); tok != "" {
			if v, err := strconv.Atoi(tok); err == nil {
				offset = int32(v)
			}
		}
	}
	nextOffset := offset + pageSize
	if int64(nextOffset) < total {
		nextPageToken = strconv.Itoa(int(nextOffset))
	}

	return &riokuv1.TraceQueryResult{
		Traces: traces,
		Page: &riokuv1.PageResponse{
			Total:         total,
			NextPageToken: nextPageToken,
		},
	}, nil
}

// GetTrace returns a single trace by its ID.
func (s *trafficService) GetTrace(ctx context.Context, req *riokuv1.GetTraceRequest) (*riokuv1.RequestTrace, error) {
	trace, err := s.store.GetTrace(ctx, req.GetTraceId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get trace: %v", err)
	}
	if trace == nil {
		return nil, status.Errorf(codes.NotFound, "trace %q not found", req.GetTraceId())
	}
	return trace, nil
}

// GetStats returns pre-aggregated traffic statistics for a time range.
func (s *trafficService) GetStats(ctx context.Context, req *riokuv1.StatsQuery) (*riokuv1.TrafficStats, error) {
	since, until := parseTimeRange(req.GetSince(), req.GetUntil())

	buckets, err := s.store.GetStatsBuckets(ctx, since, until)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get stats buckets: %v", err)
	}

	protoBuckets := make([]*riokuv1.StatsBucket, len(buckets))
	for i, b := range buckets {
		protoBuckets[i] = &riokuv1.StatsBucket{
			BucketStart:  timestamppb.New(b.BucketStart),
			RequestCount: b.RequestCount,
			ErrorCount:   b.ErrorCount,
			P50LatencyMs: b.P50LatencyMS,
			P95LatencyMs: b.P95LatencyMS,
			P99LatencyMs: b.P99LatencyMS,
			BytesSent:    b.BytesSent,
			BytesRecv:    b.BytesRecv,
		}
	}

	return &riokuv1.TrafficStats{Buckets: protoBuckets}, nil
}

// GetTokenStats returns AI token usage statistics with totals and per-model breakdown.
func (s *trafficService) GetTokenStats(ctx context.Context, req *riokuv1.TokenQuery) (*riokuv1.TokenStats, error) {
	since, until := parseTimeRange(req.GetSince(), req.GetUntil())

	modelBuckets, err := s.store.GetModelBuckets(ctx, since, until)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get model buckets: %v", err)
	}

	// Build per-bucket token aggregation and per-model breakdown.
	type modelKey struct{ provider, model string }
	breakdownMap := make(map[modelKey]*riokuv1.ModelBreakdown)
	var tokenBuckets []*riokuv1.TokenBucket
	var totalTokens, totalRequests int64
	var totalCost float64

	for _, mb := range modelBuckets {
		tokenBuckets = append(tokenBuckets, &riokuv1.TokenBucket{
			BucketStart:      timestamppb.New(mb.BucketStart),
			TotalTokens:      mb.TotalTokens,
			EstimatedCostUsd: mb.EstimatedCostUSD,
			RequestCount:     mb.RequestCount,
		})

		totalTokens += mb.TotalTokens
		totalRequests += mb.RequestCount
		totalCost += mb.EstimatedCostUSD

		k := modelKey{mb.Provider, mb.Model}
		bd, ok := breakdownMap[k]
		if !ok {
			bd = &riokuv1.ModelBreakdown{
				Provider: mb.Provider,
				Model:    mb.Model,
			}
			breakdownMap[k] = bd
		}
		bd.TotalTokens += mb.TotalTokens
		bd.EstimatedCostUsd += mb.EstimatedCostUSD
		bd.RequestCount += mb.RequestCount
	}

	breakdown := make([]*riokuv1.ModelBreakdown, 0, len(breakdownMap))
	for _, bd := range breakdownMap {
		breakdown = append(breakdown, bd)
	}

	return &riokuv1.TokenStats{
		Buckets: tokenBuckets,
		Totals: &riokuv1.TokenTotals{
			TotalTokens:      totalTokens,
			EstimatedCostUsd: totalCost,
			RequestCount:     totalRequests,
		},
		ModelBreakdown: breakdown,
	}, nil
}

// ListSessions returns a paginated list of agent session summaries.
func (s *trafficService) ListSessions(ctx context.Context, req *riokuv1.SessionQuery) (*riokuv1.SessionList, error) {
	var sinceTime time.Time
	if req.GetSince() != nil {
		sinceTime = req.GetSince().AsTime()
	}

	limit := 50
	offset := 0
	if p := req.GetPage(); p != nil {
		if p.GetPageSize() > 0 {
			limit = int(p.GetPageSize())
		}
		if tok := p.GetPageToken(); tok != "" {
			if v, err := strconv.Atoi(tok); err == nil {
				offset = v
			}
		}
	}

	sessions, total, err := s.store.ListSessions(ctx, req.GetActiveOnly(), sinceTime, limit, offset)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list sessions: %v", err)
	}

	protoSessions := make([]*riokuv1.AgentSession, len(sessions))
	for i, ss := range sessions {
		protoSessions[i] = sessionSummaryToProto(ss)
	}

	var nextPageToken string
	nextOffset := offset + limit
	if int64(nextOffset) < total {
		nextPageToken = strconv.Itoa(nextOffset)
	}

	return &riokuv1.SessionList{
		Sessions: protoSessions,
		Page: &riokuv1.PageResponse{
			Total:         total,
			NextPageToken: nextPageToken,
		},
	}, nil
}

// GetSession returns the detail of a single agent session with all its turns.
func (s *trafficService) GetSession(ctx context.Context, req *riokuv1.GetSessionRequest) (*riokuv1.SessionDetail, error) {
	traces, err := s.store.GetSessionTraces(ctx, req.GetSessionId())
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get session traces: %v", err)
	}
	if len(traces) == 0 {
		return nil, status.Errorf(codes.NotFound, "session %q not found", req.GetSessionId())
	}

	// Build a summary from the traces.
	summary := buildSessionSummary(req.GetSessionId(), traces)

	return &riokuv1.SessionDetail{
		Session: summary,
		Turns:   traces,
	}, nil
}

// buildSessionSummary constructs an AgentSession proto from a slice of traces
// belonging to the same session.
func buildSessionSummary(sessionID string, traces []*riokuv1.RequestTrace) *riokuv1.AgentSession {
	session := &riokuv1.AgentSession{
		SessionId: sessionID,
		TurnCount: int32(len(traces)),
	}

	var totalTokens int64
	var totalCost float64

	for _, tr := range traces {
		if ai := tr.GetAi(); ai != nil {
			totalTokens += ai.GetTotalTokens()
			totalCost += ai.GetEstimatedCostUsd()
			if session.AgentId == "" {
				session.AgentId = ai.GetAgentId()
			}
		}
	}

	session.TotalTokens = totalTokens
	session.EstimatedCostUsd = totalCost

	if len(traces) > 0 {
		session.StartedAt = traces[0].GetStartedAt()
		session.LastSeenAt = traces[len(traces)-1].GetStartedAt()
	}

	return session
}

// sessionSummaryToProto converts a tracestore.SessionSummary to the proto type.
func sessionSummaryToProto(ss tracestore.SessionSummary) *riokuv1.AgentSession {
	return &riokuv1.AgentSession{
		SessionId:        ss.SessionID,
		AgentId:          ss.AgentID,
		AgentName:        ss.AgentName,
		TurnCount:        int32(ss.TurnCount),
		TotalTokens:      ss.TotalTokens,
		EstimatedCostUsd: ss.EstimatedCostUSD,
		Active:           ss.Active,
		StartedAt:        timestamppb.New(ss.StartedAt),
		LastSeenAt:       timestamppb.New(ss.LastSeenAt),
	}
}

// parseTimeRange extracts since/until from proto timestamps, defaulting to
// the last 24 hours if either is nil.
func parseTimeRange(since, until *timestamppb.Timestamp) (time.Time, time.Time) {
	now := time.Now().UTC()
	s := now.Add(-24 * time.Hour)
	u := now
	if since != nil {
		s = since.AsTime()
	}
	if until != nil {
		u = until.AsTime()
	}
	return s, u
}

// Verify interface compliance at compile time.
var _ riokuv1.TrafficServiceServer = (*trafficService)(nil)
