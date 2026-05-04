package grpc

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

func setupWAFTest(t *testing.T) (riokuv1.WAFServiceServer, store.Driver, context.Context) {
	t.Helper()
	ctx := context.Background()
	d, err := store.New("sqlite")
	if err != nil {
		t.Fatal(err)
	}
	dbPath := filepath.Join(t.TempDir(), "test.db")
	if err := d.Open(ctx, store.DriverConfig{Path: dbPath}); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.Close() })
	if err := d.Migrate(ctx, store.MigrateUp); err != nil {
		t.Fatal(err)
	}
	svc := newWAFService(d)
	return svc, d, store.WithTenantID(ctx, "tenant_default")
}

func seedDenials(t *testing.T, d store.Driver, ctx context.Context, n int) {
	t.Helper()
	tx, _ := d.Begin(ctx, store.TxOptions{})
	for i := 0; i < n; i++ {
		_ = tx.AppendWAFDenial(ctx, &store.WAFDenial{
			ID:         "wd_" + uuid.NewString(),
			TenantID:   "tenant_default",
			RuleID:     "942100",
			Severity:   "WARNING",
			Action:     "block",
			RequestURI: "/api/test",
			ClientIP:   "10.0.0.1",
			MatchedAt:  time.Now().UTC(),
		})
	}
	_ = tx.Commit()
}

func TestWAF_ListDenials_Empty(t *testing.T) {
	svc, _, ctx := setupWAFTest(t)
	resp, err := svc.ListWAFDenials(ctx, &riokuv1.ListWAFDenialsRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.GetDenials()) != 0 {
		t.Errorf("len = %d, want 0", len(resp.GetDenials()))
	}
	if resp.GetNextCursor() != "" {
		t.Errorf("cursor = %q, want empty", resp.GetNextCursor())
	}
}

func TestWAF_ListDenials_Pagination(t *testing.T) {
	svc, d, ctx := setupWAFTest(t)
	seedDenials(t, d, ctx, 7)

	// First page: limit 3, expect 3 items + cursor.
	resp, err := svc.ListWAFDenials(ctx, &riokuv1.ListWAFDenialsRequest{Limit: 3})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.GetDenials()) != 3 {
		t.Errorf("page1 len = %d, want 3", len(resp.GetDenials()))
	}
	if resp.GetNextCursor() == "" {
		t.Error("page1 cursor empty, want non-empty (more rows exist)")
	}

	// Second page using returned cursor.
	resp2, err := svc.ListWAFDenials(ctx, &riokuv1.ListWAFDenialsRequest{Limit: 3, Cursor: resp.GetNextCursor()})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp2.GetDenials()) != 3 {
		t.Errorf("page2 len = %d, want 3", len(resp2.GetDenials()))
	}

	// Third page: 1 row remains, no further cursor.
	resp3, err := svc.ListWAFDenials(ctx, &riokuv1.ListWAFDenialsRequest{Limit: 3, Cursor: resp2.GetNextCursor()})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp3.GetDenials()) != 1 {
		t.Errorf("page3 len = %d, want 1", len(resp3.GetDenials()))
	}
	if resp3.GetNextCursor() != "" {
		t.Errorf("page3 cursor = %q, want empty (no more rows)", resp3.GetNextCursor())
	}
}

func TestWAF_ListDenials_InvalidCursor(t *testing.T) {
	svc, _, ctx := setupWAFTest(t)
	_, err := svc.ListWAFDenials(ctx, &riokuv1.ListWAFDenialsRequest{Cursor: "garbage"})
	if status.Code(err) != codes.InvalidArgument {
		t.Errorf("code = %s, want InvalidArgument", status.Code(err))
	}
}

func TestWAF_ListDenials_LimitClamped(t *testing.T) {
	svc, d, ctx := setupWAFTest(t)
	seedDenials(t, d, ctx, 3)
	resp, err := svc.ListWAFDenials(ctx, &riokuv1.ListWAFDenialsRequest{Limit: 9999})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.GetDenials()) != 3 {
		t.Errorf("len = %d", len(resp.GetDenials()))
	}
}
