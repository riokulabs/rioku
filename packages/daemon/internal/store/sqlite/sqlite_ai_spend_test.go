package sqlite_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/riokulabs/rioku/internal/store"
	_ "github.com/riokulabs/rioku/internal/store/sqlite"
)

func newSpendLog(t *testing.T, modelID string, cost float64, status string) *store.AISpendLog {
	t.Helper()
	vk := "vk_" + uuid.NewString()[:8]
	return &store.AISpendLog{
		ID:           "spend_" + uuid.NewString(),
		TenantID:     "tenant_default",
		VirtualKeyID: &vk,
		ModelID:      modelID,
		InputTokens:  1000,
		OutputTokens: 500,
		CostUSD:      cost,
		LatencyMS:    250,
		Status:       status,
		RequestID:    "req-" + uuid.NewString()[:8],
	}
}

func TestAISpendLog_RoundTrip(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	log := newSpendLog(t, "gpt-4o", 0.0025, "ok")
	if err := tx.AppendAISpendLog(ctx, log); err != nil {
		t.Fatalf("Append: %v", err)
	}
	got, err := tx.GetAISpendLog(ctx, log.ID)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got.ModelID != "gpt-4o" || got.CostUSD != 0.0025 {
		t.Fatalf("round-trip lost fields: %+v", got)
	}
	// TotalTokens defaulted from in+out.
	if got.TotalTokens != 1500 {
		t.Errorf("TotalTokens = %d, want 1500 (auto-computed)", got.TotalTokens)
	}
}

func TestAISpendLog_GetMissingReturnsSentinel(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx.Rollback() //nolint:errcheck

	_, err := tx.GetAISpendLog(ctx, "nope")
	if !errors.Is(err, store.ErrAISpendLogNotFound) {
		t.Fatalf("err = %v, want wrap ErrAISpendLogNotFound", err)
	}
}

func TestAISpendLog_QueryFilters(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})
	defer tx.Rollback() //nolint:errcheck

	for _, model := range []string{"gpt-4o", "gpt-4o", "claude-3-5-sonnet-20241022"} {
		_ = tx.AppendAISpendLog(ctx, newSpendLog(t, model, 0.001, "ok"))
	}
	_ = tx.AppendAISpendLog(ctx, newSpendLog(t, "gpt-4o", 0.001, "error"))

	all, err := tx.QueryAISpendLogs(ctx, store.AISpendQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 4 {
		t.Errorf("len(all) = %d, want 4", len(all))
	}

	gpt, _ := tx.QueryAISpendLogs(ctx, store.AISpendQuery{ModelID: "gpt-4o"})
	if len(gpt) != 3 {
		t.Errorf("len(gpt) = %d, want 3", len(gpt))
	}

	errors, _ := tx.QueryAISpendLogs(ctx, store.AISpendQuery{Status: "error"})
	if len(errors) != 1 {
		t.Errorf("len(errors) = %d, want 1", len(errors))
	}
}

func TestAISpendLog_Prune(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})

	// Insert with explicit old created_at via direct Append + a
	// pre-set CreatedAt.
	old := newSpendLog(t, "gpt-4o", 0.001, "ok")
	old.CreatedAt = time.Now().Add(-30 * 24 * time.Hour)
	_ = tx.AppendAISpendLog(ctx, old)

	fresh := newSpendLog(t, "gpt-4o", 0.001, "ok")
	_ = tx.AppendAISpendLog(ctx, fresh)
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	defer tx2.Rollback() //nolint:errcheck
	pruned, err := tx2.PruneAISpendLogs(ctx, time.Now().Add(-7*24*time.Hour))
	if err != nil {
		t.Fatal(err)
	}
	if pruned != 1 {
		t.Errorf("pruned = %d, want 1", pruned)
	}
	remaining, _ := tx2.QueryAISpendLogs(ctx, store.AISpendQuery{})
	if len(remaining) != 1 {
		t.Errorf("remaining = %d, want 1", len(remaining))
	}
}

func TestAISpendLog_AggregateAndQueryRollups(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})

	// Two requests on the same vk + model on the same day.
	vk := "vk_shared"
	for i := 0; i < 2; i++ {
		_ = tx.AppendAISpendLog(ctx, &store.AISpendLog{
			ID:           "spend_" + uuid.NewString(),
			TenantID:     "tenant_default",
			VirtualKeyID: &vk,
			ModelID:      "gpt-4o",
			InputTokens:  100,
			OutputTokens: 50,
			TotalTokens:  150,
			CostUSD:      0.01,
			Status:       "ok",
		})
	}
	// One error request.
	_ = tx.AppendAISpendLog(ctx, &store.AISpendLog{
		ID: "spend_" + uuid.NewString(), TenantID: "tenant_default",
		VirtualKeyID: &vk, ModelID: "gpt-4o",
		InputTokens: 10, OutputTokens: 0, TotalTokens: 10,
		CostUSD: 0.001, Status: "error",
	})
	_ = tx.Commit()

	tx2, _ := d.Begin(ctx, store.TxOptions{})
	processed, err := tx2.AggregateAISpendDay(ctx, time.Now())
	if err != nil {
		t.Fatalf("Aggregate: %v", err)
	}
	if processed != 1 {
		t.Errorf("processed = %d, want 1 (single (vk, model) bucket)", processed)
	}
	_ = tx2.Commit()

	tx3, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx3.Rollback() //nolint:errcheck
	rollups, err := tx3.QueryAISpendRollups(ctx, store.AISpendRollupQuery{})
	if err != nil {
		t.Fatal(err)
	}
	if len(rollups) != 1 {
		t.Fatalf("len(rollups) = %d, want 1", len(rollups))
	}
	r := rollups[0]
	if r.RequestCount != 3 {
		t.Errorf("RequestCount = %d, want 3", r.RequestCount)
	}
	if r.ErrorCount != 1 {
		t.Errorf("ErrorCount = %d, want 1", r.ErrorCount)
	}
	if r.TotalTokens != 310 {
		t.Errorf("TotalTokens = %d, want 310", r.TotalTokens)
	}
}

func TestAISpendLog_AggregateIdempotent(t *testing.T) {
	d, close := openTempStore(t)
	defer close()
	ctx := tenantCtx(t)
	tx, _ := d.Begin(ctx, store.TxOptions{})

	vk := "vk_idem"
	_ = tx.AppendAISpendLog(ctx, &store.AISpendLog{
		ID: "spend_" + uuid.NewString(), TenantID: "tenant_default",
		VirtualKeyID: &vk, ModelID: "gpt-4o",
		InputTokens: 100, OutputTokens: 50, TotalTokens: 150,
		CostUSD: 0.01, Status: "ok",
	})
	_ = tx.Commit()

	// Aggregate twice — second should upsert, not error.
	for i := 0; i < 2; i++ {
		tx2, _ := d.Begin(ctx, store.TxOptions{})
		if _, err := tx2.AggregateAISpendDay(ctx, time.Now()); err != nil {
			t.Fatalf("Aggregate iter %d: %v", i, err)
		}
		_ = tx2.Commit()
	}

	tx3, _ := d.Begin(ctx, store.TxOptions{ReadOnly: true})
	defer tx3.Rollback() //nolint:errcheck
	rollups, _ := tx3.QueryAISpendRollups(ctx, store.AISpendRollupQuery{})
	if len(rollups) != 1 {
		t.Errorf("len(rollups) after re-run = %d, want 1", len(rollups))
	}
}
