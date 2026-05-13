// Package gateway: Notifications REST endpoints.
//
// Routes (per the admin panel mock):
//
//	GET    /api/v1/t/{tenant}/notifications                      list inbox
//	GET    /api/v1/t/{tenant}/notifications/unread-count         badge counter
//	GET    /api/v1/t/{tenant}/notifications/{id}                 detail
//	POST   /api/v1/t/{tenant}/notifications/{id}/read            mark read
//	POST   /api/v1/t/{tenant}/notifications/{id}/unread          mark unread (inverse of /read)
//	POST   /api/v1/t/{tenant}/notifications/read-all             bulk mark read
//	POST   /api/v1/t/{tenant}/notifications/{id}/archive         archive
//	POST   /api/v1/t/{tenant}/notifications/{id}/unarchive       unarchive
//
//	/api/v1/t/{tenant}/notification-channels      (CRUD + /test)
//	/api/v1/t/{tenant}/notification-routing       (CRUD + PUT /order)
//	/api/v1/t/{tenant}/notification-log           (list + get)
package gateway

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/riokulabs/rioku/internal/auth"
	"github.com/riokulabs/rioku/internal/notifications"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// channelDispatcherOnce lazily constructs a process-wide
// notifications.ChannelDispatcher backed by the wired store. Tests
// override this via SetChannelDispatcherForTest below.
var (
	channelDispatcherMu      sync.Mutex
	channelDispatcherFactory func(store.Driver) *notifications.ChannelDispatcher
	channelDispatcher        *notifications.ChannelDispatcher
)

// SetChannelDispatcherForTest replaces the channel-send dispatcher used
// by handleTestChannel. Pass nil to reset.
func SetChannelDispatcherForTest(d *notifications.ChannelDispatcher) {
	channelDispatcherMu.Lock()
	defer channelDispatcherMu.Unlock()
	channelDispatcher = d
}

func getChannelDispatcher(st store.Driver) *notifications.ChannelDispatcher {
	channelDispatcherMu.Lock()
	defer channelDispatcherMu.Unlock()
	if channelDispatcher != nil {
		return channelDispatcher
	}
	if channelDispatcherFactory != nil {
		channelDispatcher = channelDispatcherFactory(st)
		return channelDispatcher
	}
	d := notifications.NewChannelDispatcher(st, slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	// Sandbox / dev default: mailpit at localhost:1025. Override via
	// RIOKU_SMTP_HOST / RIOKU_SMTP_PORT in production.
	if h := os.Getenv("RIOKU_SMTP_HOST"); h != "" {
		d.DefaultSMTPHost = h
	} else {
		d.DefaultSMTPHost = "localhost"
	}
	if p := os.Getenv("RIOKU_SMTP_PORT"); p != "" {
		if n, err := strconv.Atoi(p); err == nil {
			d.DefaultSMTPPort = n
		}
	} else {
		d.DefaultSMTPPort = 1025
	}
	channelDispatcher = d
	return d
}

func RegisterNotificationsRoutes(mux *http.ServeMux, st store.Driver) {
	// Inbox
	mux.Handle("GET /api/v1/t/{tenant}/notifications",
		RequirePermission("notification:read")(rerr.H(handleListNotifications(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notifications/unread-count",
		RequirePermission("notification:read")(rerr.H(handleUnreadCount(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notifications/{id}",
		RequirePermission("notification:read")(rerr.H(handleGetNotification(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/read",
		RequirePermission("notification:manage-own")(rerr.H(handleMarkNotificationRead(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/unread",
		RequirePermission("notification:manage-own")(rerr.H(handleMarkNotificationUnread(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/read-all",
		RequirePermission("notification:manage-own")(rerr.H(handleMarkAllRead(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/archive",
		RequirePermission("notification:manage-own")(rerr.H(handleArchiveNotification(st, true))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/unarchive",
		RequirePermission("notification:manage-own")(rerr.H(handleArchiveNotification(st, false))))

	// Channels
	mux.Handle("GET /api/v1/t/{tenant}/notification-channels",
		RequirePermission("notification-channel:read")(rerr.H(handleListChannels(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notification-channels",
		RequirePermission("notification-channel:write")(rerr.H(handleCreateChannel(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notification-channels/{id}",
		RequirePermission("notification-channel:read")(rerr.H(handleGetChannel(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/notification-channels/{id}",
		RequirePermission("notification-channel:write")(rerr.H(handleUpdateChannel(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/notification-channels/{id}",
		RequirePermission("notification-channel:write")(rerr.H(handleDeleteChannel(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notification-channels/{id}/test",
		RequirePermission("notification-channel:test")(rerr.H(handleTestChannel(st))))

	// Routing rules
	mux.Handle("GET /api/v1/t/{tenant}/notification-routing",
		RequirePermission("notification-routing:read")(rerr.H(handleListRules(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notification-routing",
		RequirePermission("notification-routing:write")(rerr.H(handleCreateRule(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/notification-routing/order",
		RequirePermission("notification-routing:write")(rerr.H(handleReorderRules(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notification-routing/{id}",
		RequirePermission("notification-routing:read")(rerr.H(handleGetRule(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/notification-routing/{id}",
		RequirePermission("notification-routing:write")(rerr.H(handleUpdateRule(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/notification-routing/{id}",
		RequirePermission("notification-routing:write")(rerr.H(handleDeleteRule(st))))

	// Delivery log
	mux.Handle("GET /api/v1/t/{tenant}/notification-log",
		RequirePermission("notification-log:read")(rerr.H(handleListDeliveryLog(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notification-log/{id}",
		RequirePermission("notification-log:read")(rerr.H(handleGetDeliveryLog(st))))

	// Sandbox / admin: bulk-seed inbox notifications. Restricted to
	// notification:admin so only operators can seed; the sandbox seeder
	// uses this to populate demo data without depending on an upstream
	// event source.
	mux.Handle("POST /api/v1/t/{tenant}/notifications/seed",
		RequirePermission("notification:admin")(rerr.H(handleSeedNotifications(st))))

	// Tenant notification config (singleton-per-tenant)
	mux.Handle("GET /api/v1/t/{tenant}/settings/notifications",
		RequirePermission("notification:admin")(rerr.H(handleGetTenantNotifConfig(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/notifications",
		RequirePermission("notification:admin")(rerr.H(handleUpdateTenantNotifConfig(st))))
}

// ─── DTOs ───────────────────────────────────────────────────────────────────

type notificationItemResponse struct {
	ID         string          `json:"id"`
	TenantID   *string         `json:"tenantId,omitempty"`
	UserID     string          `json:"userId"`
	Category   string          `json:"category"`
	Severity   string          `json:"severity"`
	Title      string          `json:"title"`
	Body       string          `json:"body"`
	ActionLink *string         `json:"actionLink,omitempty"`
	Metadata   json.RawMessage `json:"metadata"`
	ReadAt     *string         `json:"readAt,omitempty"`
	ArchivedAt *string         `json:"archivedAt,omitempty"`
	OccurredAt string          `json:"occurredAt"`
}

func notificationItemToResponse(n *store.NotificationItem) notificationItemResponse {
	out := notificationItemResponse{
		ID: n.ID, TenantID: n.TenantID, UserID: n.UserID, Category: n.Category, Severity: n.Severity,
		Title: n.Title, Body: n.Body, ActionLink: n.ActionLink,
		Metadata:   rawOrEmpty(n.Metadata, "{}"),
		OccurredAt: n.OccurredAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
	if n.ReadAt != nil {
		s := n.ReadAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.ReadAt = &s
	}
	if n.ArchivedAt != nil {
		s := n.ArchivedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.ArchivedAt = &s
	}
	return out
}

type channelResponse struct {
	ID        string          `json:"id"`
	TenantID  string          `json:"tenantId"`
	Name      string          `json:"name"`
	Kind      string          `json:"kind"`
	Config    json.RawMessage `json:"config"`
	Enabled   bool            `json:"enabled"`
	CreatedAt string          `json:"createdAt"`
	UpdatedAt string          `json:"updatedAt"`
}

func channelToResponse(c *store.NotificationChannel) channelResponse {
	return channelResponse{
		ID: c.ID, TenantID: c.TenantID, Name: c.Name, Kind: c.Kind,
		Config:    rawOrEmpty(c.Config, "{}"),
		Enabled:   c.Enabled,
		CreatedAt: c.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type routingRuleResponse struct {
	ID          string          `json:"id"`
	TenantID    string          `json:"tenantId"`
	Name        string          `json:"name"`
	EventFilter json.RawMessage `json:"eventFilter"`
	ChannelIDs  json.RawMessage `json:"channelIds"`
	Enabled     bool            `json:"enabled"`
	OrderHint   int32           `json:"orderHint"`
	CreatedAt   string          `json:"createdAt"`
	UpdatedAt   string          `json:"updatedAt"`
}

func routingRuleToResponse(r *store.NotificationRoutingRule) routingRuleResponse {
	return routingRuleResponse{
		ID: r.ID, TenantID: r.TenantID, Name: r.Name,
		EventFilter: rawOrEmpty(r.EventFilter, "{}"),
		ChannelIDs:  rawOrEmpty(r.ChannelIDs, "[]"),
		Enabled:     r.Enabled, OrderHint: r.OrderHint,
		CreatedAt: r.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
		UpdatedAt: r.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

type deliveryLogResponse struct {
	ID               string          `json:"id"`
	TenantID         string          `json:"tenantId"`
	ChannelID        *string         `json:"channelId,omitempty"`
	NotificationID   *string         `json:"notificationId,omitempty"`
	Status           string          `json:"status"`
	Attempts         int32           `json:"attempts"`
	FirstAttemptedAt *string         `json:"firstAttemptedAt,omitempty"`
	LastAttemptedAt  *string         `json:"lastAttemptedAt,omitempty"`
	LastError        *string         `json:"lastError,omitempty"`
	Metadata         json.RawMessage `json:"metadata"`
}

func deliveryLogToResponse(e *store.NotificationDeliveryLogEntry) deliveryLogResponse {
	out := deliveryLogResponse{
		ID: e.ID, TenantID: e.TenantID, ChannelID: e.ChannelID, NotificationID: e.NotificationID,
		Status: e.Status, Attempts: e.Attempts, LastError: e.LastError,
		Metadata: rawOrEmpty(e.Metadata, "{}"),
	}
	if e.FirstAttemptedAt != nil {
		s := e.FirstAttemptedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.FirstAttemptedAt = &s
	}
	if e.LastAttemptedAt != nil {
		s := e.LastAttemptedAt.UTC().Format("2006-01-02T15:04:05.000Z")
		out.LastAttemptedAt = &s
	}
	return out
}

type tenantNotifConfigResponse struct {
	TenantID            string          `json:"tenantId"`
	Enabled             bool            `json:"enabled"`
	OptInMode           string          `json:"optInMode"`
	MaxRetries          int32           `json:"maxRetries"`
	RetryBackoffSeconds int32           `json:"retryBackoffSeconds"`
	ChannelPriority     json.RawMessage `json:"channelPriority"`
	UpdatedAt           string          `json:"updatedAt"`
}

func tenantNotifConfigToResponse(c *store.TenantNotificationConfig) tenantNotifConfigResponse {
	return tenantNotifConfigResponse{
		TenantID: c.TenantID, Enabled: c.Enabled, OptInMode: c.OptInMode,
		MaxRetries: c.MaxRetries, RetryBackoffSeconds: c.RetryBackoffSeconds,
		ChannelPriority: rawOrEmpty(c.ChannelPriority, "[]"),
		UpdatedAt:       c.UpdatedAt.UTC().Format("2006-01-02T15:04:05.000Z"),
	}
}

// ─── Inbox handlers ─────────────────────────────────────────────────────────

func notificationQueryFromRequest(r *http.Request) store.NotificationItemQuery {
	q := store.NotificationItemQuery{
		Category: r.URL.Query().Get("category"),
		Severity: r.URL.Query().Get("severity"),
	}
	if v := r.URL.Query().Get("read"); v != "" {
		b := v == "true"
		q.Read = &b
	}
	if v := r.URL.Query().Get("archived"); v != "" {
		b := v == "true"
		q.Archived = &b
	}
	if v := r.URL.Query().Get("limit"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			q.Limit = n
		}
	}
	if v := r.URL.Query().Get("offset"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			q.Offset = n
		}
	}
	return q
}

// handleSeedNotifications accepts a JSON body of inbox notifications
// and inserts each into the per-user inbox. Used by the sandbox seeder
// to populate demo data; restricted to notification:admin so only
// operators can call it.
func handleSeedNotifications(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Items []struct {
				Username   string `json:"username"`
				UserID     string `json:"userId"`
				Category   string `json:"category"`
				Severity   string `json:"severity"`
				Title      string `json:"title"`
				Body       string `json:"body"`
				ActionLink string `json:"actionLink,omitempty"`
				OccurredAt string `json:"occurredAt,omitempty"`
				Read       bool   `json:"read,omitempty"`
				Archived   bool   `json:"archived,omitempty"`
			} `json:"items"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// Resolve usernames -> user IDs once.
		userIDs := make(map[string]string)
		now := time.Now().UTC()
		inserted := 0
		for _, it := range req.Items {
			uid := it.UserID
			if uid == "" && it.Username != "" {
				if cached, ok := userIDs[it.Username]; ok {
					uid = cached
				} else {
					u, lookupErr := tx.GetUserByUsername(r.Context(), it.Username)
					if lookupErr != nil || u == nil {
						// Skip — log via response, do not fail the bulk op.
						continue
					}
					uid = u.ID
					userIDs[it.Username] = uid
				}
			}
			if uid == "" {
				continue
			}
			occurred := now
			if it.OccurredAt != "" {
				if parsed, parseErr := time.Parse(time.RFC3339, it.OccurredAt); parseErr == nil {
					occurred = parsed.UTC()
				}
			}
			tID := tenant.ID
			n := &store.NotificationItem{
				TenantID: &tID, UserID: uid, Category: it.Category, Severity: it.Severity,
				Title: it.Title, Body: it.Body, OccurredAt: occurred,
			}
			if it.ActionLink != "" {
				al := it.ActionLink
				n.ActionLink = &al
			}
			if it.Read {
				rt := occurred
				n.ReadAt = &rt
			}
			if it.Archived {
				at := occurred
				n.ArchivedAt = &at
			}
			if _, appendErr := tx.AppendNotificationItem(r.Context(), n); appendErr != nil {
				return rerr.Wrap(appendErr, "append")
			}
			inserted++
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, map[string]any{"inserted": inserted})
	}
}

func handleListNotifications(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			return rerr.Unauthenticated()
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListNotificationItemsByUser(r.Context(), tenant.ID, sc.UserID, notificationQueryFromRequest(r))
		if err != nil {
			return rerr.Wrap(err, "list notifications")
		}
		out := make([]notificationItemResponse, 0, len(items))
		for _, n := range items {
			out = append(out, notificationItemToResponse(n))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleUnreadCount(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			return rerr.Unauthenticated()
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		count, err := tx.CountUnreadNotifications(r.Context(), tenant.ID, sc.UserID)
		if err != nil {
			return rerr.Wrap(err, "count unread")
		}
		return rerr.JSON(w, map[string]any{"unreadCount": count})
	}
}

func handleGetNotification(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			return rerr.NotFound("notification", id)
		}
		// Cross-user/tenant guard.
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			return rerr.NotFound("notification", id)
		}
		if n.TenantID != nil && *n.TenantID != tenant.ID {
			return rerr.NotFound("notification", id)
		}
		return rerr.JSON(w, notificationItemToResponse(n))
	}
}

func handleMarkNotificationRead(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if _, ok := tenantOrError(w, r); !ok {
			return nil
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		// Ownership guard.
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			return rerr.NotFound("notification", id)
		}
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			return rerr.NotFound("notification", id)
		}
		if err := tx.MarkNotificationRead(r.Context(), id); err != nil {
			return rerr.Wrap(err, "mark read")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// handleMarkNotificationUnread is the inverse of handleMarkNotificationRead:
// clears the read_at timestamp on a notification owned by the calling user.
// Idempotent — a no-op on already-unread notifications. Same RBAC as /read
// (notification:manage-own) and the same ownership/tenant guards.
func handleMarkNotificationUnread(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if _, ok := tenantOrError(w, r); !ok {
			return nil
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		// Ownership guard.
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			return rerr.NotFound("notification", id)
		}
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			return rerr.NotFound("notification", id)
		}
		if err := tx.MarkNotificationUnread(r.Context(), id); err != nil {
			return rerr.Wrap(err, "mark unread")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func handleMarkAllRead(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			return rerr.Unauthenticated()
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		if err := tx.MarkAllNotificationsRead(r.Context(), tenant.ID, sc.UserID); err != nil {
			return rerr.Wrap(err, "mark all read")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func handleArchiveNotification(st store.Driver, archive bool) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		if _, ok := tenantOrError(w, r); !ok {
			return nil
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			return rerr.NotFound("notification", id)
		}
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			return rerr.NotFound("notification", id)
		}
		if err := tx.ArchiveNotification(r.Context(), id, archive); err != nil {
			return rerr.Wrap(err, "archive")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ─── Channel handlers ───────────────────────────────────────────────────────

func handleListChannels(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListNotificationChannelsByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list channels")
		}
		out := make([]channelResponse, 0, len(items))
		for _, c := range items {
			out = append(out, channelToResponse(c))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateChannel(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Name   string          `json:"name"`
			Kind   string          `json:"kind"`
			Config json.RawMessage `json:"config,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		fields := map[string]string{}
		if req.Name == "" {
			fields["name"] = "name is required"
		}
		if req.Kind == "" {
			fields["kind"] = "kind is required"
		}
		if len(fields) > 0 {
			return rerr.Validation(fields)
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		created, err := tx.CreateNotificationChannel(r.Context(), &store.NotificationChannel{
			TenantID: tenant.ID, Name: req.Name, Kind: req.Kind, Config: string(req.Config), Enabled: true,
		})
		if err != nil {
			if errors.Is(err, store.ErrNotificationChannelTaken) {
				return rerr.Conflict("a channel with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create channel")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, channelToResponse(created))
	}
}

func handleGetChannel(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		c, err := tx.GetNotificationChannel(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("notification channel", id)
		}
		return rerr.JSON(w, channelToResponse(c))
	}
}

func handleUpdateChannel(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Name    *string          `json:"name,omitempty"`
			Kind    *string          `json:"kind,omitempty"`
			Config  *json.RawMessage `json:"config,omitempty"`
			Enabled *bool            `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		params := store.UpdateNotificationChannelParams{
			Name: req.Name, Kind: req.Kind, Enabled: req.Enabled,
		}
		if req.Config != nil {
			s := string(*req.Config)
			params.Config = &s
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.UpdateNotificationChannel(r.Context(), tenant.ID, id, params)
		if err != nil {
			if errors.Is(err, store.ErrNotificationChannelNotFound) {
				return rerr.NotFound("notification channel", id)
			}
			return rerr.Wrap(err, "update channel")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, channelToResponse(updated))
	}
}

func handleDeleteChannel(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		if err := tx.DeleteNotificationChannel(r.Context(), tenant.ID, id); err != nil {
			if errors.Is(err, store.ErrNotificationChannelNotFound) {
				return rerr.NotFound("notification channel", id)
			}
			return rerr.Wrap(err, "delete channel")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func handleTestChannel(st store.Driver) rerr.Handler {
	// Resolves the stored channel, runs a single dispatch through the
	// channel-send dispatcher (with retry + delivery-log writes), and
	// returns the result. Used by the admin panel "Send test" button.
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")

		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		ch, err := tx.GetNotificationChannel(r.Context(), tenant.ID, id)
		_ = tx.Rollback()
		if err != nil {
			if errors.Is(err, store.ErrNotificationChannelNotFound) {
				return rerr.NotFound("notification channel", id)
			}
			return rerr.Wrap(err, "get channel")
		}

		msg := notifications.Message{
			Kind:     "test",
			Subject:  "Test from Rioku",
			Body:     "This is a test notification dispatched from the Rioku admin panel. If you received this, the channel is correctly configured.",
			Severity: "info",
			Metadata: map[string]any{
				"channelId":   ch.ID,
				"channelName": ch.Name,
				"channelKind": ch.Kind,
			},
		}

		disp := getChannelDispatcher(st)
		sendErr := disp.SendToChannel(r.Context(), ch, msg, nil)
		now := nowFormatted()
		if sendErr != nil {
			return rerr.BadGateway(sendErr)
		}
		return rerr.JSON(w, map[string]any{
			"channelId":   ch.ID,
			"ok":          true,
			"deliveredAt": now,
		})
	}
}

func nowFormatted() string {
	return timeNowFn().UTC().Format("2006-01-02T15:04:05.000Z")
}

// timeNowFn is a seam for tests. Defaults to time.Now.
var timeNowFn = func() time.Time { return time.Now() }

// ─── Routing rule handlers ──────────────────────────────────────────────────

func handleListRules(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListRoutingRulesByTenant(r.Context(), tenant.ID)
		if err != nil {
			return rerr.Wrap(err, "list rules")
		}
		out := make([]routingRuleResponse, 0, len(items))
		for _, rl := range items {
			out = append(out, routingRuleToResponse(rl))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateRule(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Name        string          `json:"name"`
			EventFilter json.RawMessage `json:"eventFilter,omitempty"`
			ChannelIDs  json.RawMessage `json:"channelIds,omitempty"`
			OrderHint   int32           `json:"orderHint,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.Name == "" {
			return rerr.Validation(map[string]string{"name": "name is required"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		created, err := tx.CreateRoutingRule(r.Context(), &store.NotificationRoutingRule{
			TenantID: tenant.ID, Name: req.Name, EventFilter: string(req.EventFilter),
			ChannelIDs: string(req.ChannelIDs), Enabled: true, OrderHint: req.OrderHint,
		})
		if err != nil {
			if errors.Is(err, store.ErrRoutingRuleNameTaken) {
				return rerr.Conflict("a routing rule with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create rule")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSONStatus(w, http.StatusCreated, routingRuleToResponse(created))
	}
}

func handleGetRule(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		rule, err := tx.GetRoutingRule(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("notification routing rule", id)
		}
		return rerr.JSON(w, routingRuleToResponse(rule))
	}
}

func handleUpdateRule(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		var req struct {
			Name        *string          `json:"name,omitempty"`
			EventFilter *json.RawMessage `json:"eventFilter,omitempty"`
			ChannelIDs  *json.RawMessage `json:"channelIds,omitempty"`
			Enabled     *bool            `json:"enabled,omitempty"`
			OrderHint   *int32           `json:"orderHint,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		params := store.UpdateRoutingRuleParams{
			Name: req.Name, Enabled: req.Enabled, OrderHint: req.OrderHint,
		}
		if req.EventFilter != nil {
			s := string(*req.EventFilter)
			params.EventFilter = &s
		}
		if req.ChannelIDs != nil {
			s := string(*req.ChannelIDs)
			params.ChannelIDs = &s
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.UpdateRoutingRule(r.Context(), tenant.ID, id, params)
		if err != nil {
			if errors.Is(err, store.ErrRoutingRuleNotFound) {
				return rerr.NotFound("notification routing rule", id)
			}
			return rerr.Wrap(err, "update rule")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, routingRuleToResponse(updated))
	}
}

func handleDeleteRule(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		if err := tx.DeleteRoutingRule(r.Context(), tenant.ID, id); err != nil {
			if errors.Is(err, store.ErrRoutingRuleNotFound) {
				return rerr.NotFound("notification routing rule", id)
			}
			return rerr.Wrap(err, "delete rule")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

func handleReorderRules(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			OrderedIDs []string `json:"orderedIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		if err := tx.ReorderRoutingRules(r.Context(), tenant.ID, req.OrderedIDs); err != nil {
			return rerr.Wrap(err, "reorder")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ─── Delivery log handlers ──────────────────────────────────────────────────

func handleListDeliveryLog(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		q := store.DeliveryLogQuery{Status: r.URL.Query().Get("status")}
		if v := r.URL.Query().Get("limit"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				q.Limit = n
			}
		}
		if v := r.URL.Query().Get("offset"); v != "" {
			if n, err := strconv.Atoi(v); err == nil && n >= 0 {
				q.Offset = n
			}
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListDeliveryLogByTenant(r.Context(), tenant.ID, q)
		if err != nil {
			return rerr.Wrap(err, "list log")
		}
		out := make([]deliveryLogResponse, 0, len(items))
		for _, e := range items {
			out = append(out, deliveryLogToResponse(e))
		}
		return rerr.JSON(w, map[string]any{"items": out, "total": len(out)})
	}
}

func handleGetDeliveryLog(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		id := r.PathValue("id")
		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		e, err := tx.GetDeliveryLogEntry(r.Context(), tenant.ID, id)
		if err != nil {
			return rerr.NotFound("notification delivery log entry", id)
		}
		return rerr.JSON(w, deliveryLogToResponse(e))
	}
}

// ─── Tenant config handlers ─────────────────────────────────────────────────

func handleGetTenantNotifConfig(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		return handleReadConfig(w, r, st, "get config",
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				c, err := tx.GetTenantNotificationConfig(ctx, tenantID)
				if err != nil {
					return nil, err
				}
				return tenantNotifConfigToResponse(c), nil
			})
	}
}

func handleUpdateTenantNotifConfig(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return nil
		}
		var req struct {
			Enabled             bool            `json:"enabled"`
			OptInMode           string          `json:"optInMode"`
			MaxRetries          int32           `json:"maxRetries"`
			RetryBackoffSeconds int32           `json:"retryBackoffSeconds"`
			ChannelPriority     json.RawMessage `json:"channelPriority,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}
		if req.OptInMode == "" {
			req.OptInMode = "opt-in"
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()
		updated, err := tx.UpsertTenantNotificationConfig(r.Context(), &store.TenantNotificationConfig{
			TenantID: tenant.ID, Enabled: req.Enabled, OptInMode: req.OptInMode,
			MaxRetries: req.MaxRetries, RetryBackoffSeconds: req.RetryBackoffSeconds,
			ChannelPriority: string(req.ChannelPriority),
		})
		if err != nil {
			return rerr.Wrap(err, "upsert config")
		}
		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}
		return rerr.JSON(w, tenantNotifConfigToResponse(updated))
	}
}
