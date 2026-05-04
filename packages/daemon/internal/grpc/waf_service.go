package grpc

import (
	"context"
	"strconv"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// wafService implements riokuv1.WAFServiceServer (#172, #203). v1
// exposes only the denial-list read path; per-route WAF config
// CRUD lands later when its admin UI work begins.
type wafService struct {
	riokuv1.UnimplementedWAFServiceServer
	store store.Driver
}

func newWAFService(st store.Driver) *wafService {
	return &wafService{store: st}
}

// defaultPageSize / maxPageSize bound the page size the client may
// request. Cursor pagination encodes the "next start row" as a
// numeric offset string — opaque to the client, simple to compute
// against the existing Limit + Offset Tx surface.
const (
	wafDefaultPageSize = 50
	wafMaxPageSize     = 500
)

func (s *wafService) ListWAFDenials(ctx context.Context, req *riokuv1.ListWAFDenialsRequest) (*riokuv1.ListWAFDenialsResponse, error) {
	limit := int(req.GetLimit())
	if limit <= 0 {
		limit = wafDefaultPageSize
	}
	if limit > wafMaxPageSize {
		limit = wafMaxPageSize
	}
	offset := 0
	if c := req.GetCursor(); c != "" {
		n, err := strconv.Atoi(c)
		if err != nil || n < 0 {
			return nil, status.Errorf(codes.InvalidArgument, "invalid cursor")
		}
		offset = n
	}

	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	// Query one extra row beyond the page size so we know whether
	// there's a next page without a separate count query.
	denials, err := tx.QueryWAFDenials(ctx, store.WAFDenialQuery{
		RouteID:  req.GetRouteId(),
		RuleID:   req.GetRuleId(),
		Severity: req.GetSeverity(),
		Limit:    limit + 1,
		Offset:   offset,
	})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "query waf_denials: %v", err)
	}

	nextCursor := ""
	if len(denials) > limit {
		denials = denials[:limit]
		nextCursor = strconv.Itoa(offset + limit)
	}

	out := make([]*riokuv1.WAFDenial, len(denials))
	for i, d := range denials {
		out[i] = wafDenialToProto(d)
	}
	return &riokuv1.ListWAFDenialsResponse{
		Denials:    out,
		NextCursor: nextCursor,
	}, nil
}

func wafDenialToProto(d *store.WAFDenial) *riokuv1.WAFDenial {
	out := &riokuv1.WAFDenial{
		Id:         d.ID,
		TenantId:   d.TenantID,
		RuleId:     d.RuleID,
		Severity:   d.Severity,
		Action:     d.Action,
		RequestUri: d.RequestURI,
		ClientIp:   d.ClientIP,
		MatchedAt:  timestamppb.New(d.MatchedAt),
		Metadata:   d.Metadata,
	}
	if d.RouteID != nil {
		out.RouteId = *d.RouteID
	}
	return out
}
