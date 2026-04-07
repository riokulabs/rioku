package grpc

import (
	"context"
	"encoding/json"

	"github.com/riokulabs/rioku/internal/config"
	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type configService struct {
	riokuv1.UnimplementedConfigServiceServer
	engine *config.Engine
}

func newConfigService(engine *config.Engine) *configService {
	return &configService{engine: engine}
}

func (s *configService) GetConfig(ctx context.Context, req *riokuv1.GetConfigRequest) (*riokuv1.ConfigSnapshot, error) {
	snap, err := s.engine.GetConfig(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "get config: %v", err)
	}
	return snap, nil
}

func (s *configService) ApplyChange(ctx context.Context, req *riokuv1.ConfigChange) (*riokuv1.ApplyResult, error) {
	actor := "anonymous"
	if claims := ClaimsFromContext(ctx); claims != nil {
		actor = claims.Subject
	}

	result, err := s.engine.ApplyChange(ctx, req, actor)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "apply change: %v", err)
	}
	return result, nil
}

func (s *configService) WatchChanges(req *riokuv1.WatchRequest, stream grpc.ServerStreamingServer[riokuv1.ConfigEvent]) error {
	ctx := stream.Context()
	ch, err := s.engine.WatchChanges(ctx, req.GetSinceVersion())
	if err != nil {
		return status.Errorf(codes.Internal, "watch changes: %v", err)
	}

	for {
		select {
		case <-ctx.Done():
			return nil
		case evt, ok := <-ch:
			if !ok {
				return nil
			}
			if err := stream.Send(evt); err != nil {
				return err
			}
		}
	}
}

func (s *configService) GetAuditLog(req *riokuv1.AuditQuery, stream grpc.ServerStreamingServer[riokuv1.AuditEntry]) error {
	ctx := stream.Context()

	query := store.AuditQuery{
		Actor:      req.GetActor(),
		EntityType: req.GetEntityType(),
		EntityID:   req.GetEntityId(),
	}
	if req.GetSince() != nil {
		t := req.GetSince().AsTime()
		query.Since = &t
	}
	if req.GetUntil() != nil {
		t := req.GetUntil().AsTime()
		query.Until = &t
	}
	if req.GetPage() != nil {
		query.Limit = int(req.GetPage().GetPageSize())
	}

	entries, err := s.engine.GetAuditLog(ctx, query)
	if err != nil {
		return status.Errorf(codes.Internal, "get audit log: %v", err)
	}

	for _, entry := range entries {
		if err := stream.Send(entry); err != nil {
			return err
		}
	}
	return nil
}

func (s *configService) ExportConfig(req *riokuv1.ExportRequest, stream grpc.ServerStreamingServer[riokuv1.ConfigChunk]) error {
	ctx := stream.Context()

	snap, err := s.engine.ExportConfig(ctx)
	if err != nil {
		return status.Errorf(codes.Internal, "export config: %v", err)
	}

	// Serialize the snapshot to JSON and send as a single chunk.
	data, err := json.Marshal(snap)
	if err != nil {
		return status.Errorf(codes.Internal, "marshal snapshot: %v", err)
	}

	// Chunk into 64KB pieces for large configs.
	const chunkSize = 64 * 1024
	seq := int32(0)
	for offset := 0; offset < len(data); offset += chunkSize {
		end := offset + chunkSize
		if end > len(data) {
			end = len(data)
		}
		chunk := &riokuv1.ConfigChunk{
			Data:     data[offset:end],
			Sequence: seq,
			Last:     end == len(data),
		}
		if err := stream.Send(chunk); err != nil {
			return err
		}
		seq++
	}
	return nil
}

func (s *configService) ImportConfig(stream grpc.ClientStreamingServer[riokuv1.ConfigChunk, riokuv1.ImportResult]) error {
	ctx := stream.Context()

	// Reassemble chunks with size limit.
	const maxImportSize = 128 * 1024 * 1024 // 128MB
	var data []byte
	for {
		chunk, err := stream.Recv()
		if err != nil {
			return status.Errorf(codes.Internal, "receive chunk: %v", err)
		}
		data = append(data, chunk.GetData()...)
		if len(data) > maxImportSize {
			return status.Errorf(codes.InvalidArgument, "import data exceeds maximum size of %d bytes", maxImportSize)
		}
		if chunk.GetLast() {
			break
		}
	}

	// Unmarshal the snapshot.
	var snap riokuv1.ConfigSnapshot
	if err := json.Unmarshal(data, &snap); err != nil {
		return status.Errorf(codes.InvalidArgument, "invalid snapshot: %v", err)
	}

	// TODO: extract actor from auth context
	actor := "anonymous"

	result, err := s.engine.ImportConfig(ctx, &snap, actor)
	if err != nil {
		return status.Errorf(codes.Internal, "import config: %v", err)
	}

	return stream.SendAndClose(result)
}

// Verify interface compliance at compile time.
var _ riokuv1.ConfigServiceServer = (*configService)(nil)
