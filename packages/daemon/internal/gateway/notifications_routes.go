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
		RequirePermission("notification:read")(http.HandlerFunc(handleListNotifications(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notifications/unread-count",
		RequirePermission("notification:read")(http.HandlerFunc(handleUnreadCount(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notifications/{id}",
		RequirePermission("notification:read")(http.HandlerFunc(handleGetNotification(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/read",
		RequirePermission("notification:manage-own")(http.HandlerFunc(handleMarkNotificationRead(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/unread",
		RequirePermission("notification:manage-own")(http.HandlerFunc(handleMarkNotificationUnread(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/read-all",
		RequirePermission("notification:manage-own")(http.HandlerFunc(handleMarkAllRead(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/archive",
		RequirePermission("notification:manage-own")(http.HandlerFunc(handleArchiveNotification(st, true))))
	mux.Handle("POST /api/v1/t/{tenant}/notifications/{id}/unarchive",
		RequirePermission("notification:manage-own")(http.HandlerFunc(handleArchiveNotification(st, false))))

	// Channels
	mux.Handle("GET /api/v1/t/{tenant}/notification-channels",
		RequirePermission("notification-channel:read")(http.HandlerFunc(handleListChannels(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notification-channels",
		RequirePermission("notification-channel:write")(http.HandlerFunc(handleCreateChannel(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notification-channels/{id}",
		RequirePermission("notification-channel:read")(http.HandlerFunc(handleGetChannel(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/notification-channels/{id}",
		RequirePermission("notification-channel:write")(http.HandlerFunc(handleUpdateChannel(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/notification-channels/{id}",
		RequirePermission("notification-channel:write")(http.HandlerFunc(handleDeleteChannel(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notification-channels/{id}/test",
		RequirePermission("notification-channel:test")(http.HandlerFunc(handleTestChannel(st))))

	// Routing rules
	mux.Handle("GET /api/v1/t/{tenant}/notification-routing",
		RequirePermission("notification-routing:read")(http.HandlerFunc(handleListRules(st))))
	mux.Handle("POST /api/v1/t/{tenant}/notification-routing",
		RequirePermission("notification-routing:write")(http.HandlerFunc(handleCreateRule(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/notification-routing/order",
		RequirePermission("notification-routing:write")(http.HandlerFunc(handleReorderRules(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notification-routing/{id}",
		RequirePermission("notification-routing:read")(http.HandlerFunc(handleGetRule(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/notification-routing/{id}",
		RequirePermission("notification-routing:write")(http.HandlerFunc(handleUpdateRule(st))))
	mux.Handle("DELETE /api/v1/t/{tenant}/notification-routing/{id}",
		RequirePermission("notification-routing:write")(http.HandlerFunc(handleDeleteRule(st))))

	// Delivery log
	mux.Handle("GET /api/v1/t/{tenant}/notification-log",
		RequirePermission("notification-log:read")(http.HandlerFunc(handleListDeliveryLog(st))))
	mux.Handle("GET /api/v1/t/{tenant}/notification-log/{id}",
		RequirePermission("notification-log:read")(http.HandlerFunc(handleGetDeliveryLog(st))))

	// Sandbox / admin: bulk-seed inbox notifications. Restricted to
	// notification:admin so only operators can seed; the sandbox seeder
	// uses this to populate demo data without depending on an upstream
	// event source.
	mux.Handle("POST /api/v1/t/{tenant}/notifications/seed",
		RequirePermission("notification:admin")(http.HandlerFunc(handleSeedNotifications(st))))

	// Tenant notification config (singleton-per-tenant)
	mux.Handle("GET /api/v1/t/{tenant}/settings/notifications",
		RequirePermission("notification:admin")(http.HandlerFunc(handleGetTenantNotifConfig(st))))
	mux.Handle("PUT /api/v1/t/{tenant}/settings/notifications",
		RequirePermission("notification:admin")(http.HandlerFunc(handleUpdateTenantNotifConfig(st))))
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
func handleSeedNotifications(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, err := st.Begin(r.Context(), store.TxOptions{})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
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
				writeInternalError(w, r, "append")
				return
			}
			inserted++
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"inserted": inserted})
	}
}

func handleListNotifications(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required",
				"Session required to list notifications", r.URL.Path, nil)
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListNotificationItemsByUser(r.Context(), tenant.ID, sc.UserID, notificationQueryFromRequest(r))
		if err != nil {
			writeInternalError(w, r, "list notifications")
			return
		}
		out := make([]notificationItemResponse, 0, len(items))
		for _, n := range items {
			out = append(out, notificationItemToResponse(n))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleUnreadCount(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required", "", r.URL.Path, nil)
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		count, err := tx.CountUnreadNotifications(r.Context(), tenant.ID, sc.UserID)
		if err != nil {
			writeInternalError(w, r, "count unread")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"unreadCount": count})
	}
}

func handleGetNotification(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		// Cross-user/tenant guard.
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		if n.TenantID != nil && *n.TenantID != tenant.ID {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, notificationItemToResponse(n))
	}
}

func handleMarkNotificationRead(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := tenantOrError(w, r); !ok {
			return
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Ownership guard.
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		if err := tx.MarkNotificationRead(r.Context(), id); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "mark read")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// handleMarkNotificationUnread is the inverse of handleMarkNotificationRead:
// clears the read_at timestamp on a notification owned by the calling user.
// Idempotent — a no-op on already-unread notifications. Same RBAC as /read
// (notification:manage-own) and the same ownership/tenant guards.
func handleMarkNotificationUnread(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := tenantOrError(w, r); !ok {
			return
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		// Ownership guard.
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		if err := tx.MarkNotificationUnread(r.Context(), id); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "mark unread")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleMarkAllRead(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		if sc == nil || sc.UserID == "" {
			writeProblem(w, http.StatusUnauthorized, errTypeUnauth, "Authentication required", "", r.URL.Path, nil)
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.MarkAllNotificationsRead(r.Context(), tenant.ID, sc.UserID); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "mark all read")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleArchiveNotification(st store.Driver, archive bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if _, ok := tenantOrError(w, r); !ok {
			return
		}
		sc := auth.SessionClaimsFromContext(r.Context())
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		n, err := tx.GetNotificationItem(r.Context(), id)
		if err != nil {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		if sc != nil && sc.UserID != "" && n.UserID != sc.UserID {
			_ = tx.Rollback()
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Notification not found",
				"No notification with id "+id, r.URL.Path, nil)
			return
		}
		if err := tx.ArchiveNotification(r.Context(), id, archive); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "archive")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ─── Channel handlers ───────────────────────────────────────────────────────

func handleListChannels(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListNotificationChannelsByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list channels")
			return
		}
		out := make([]channelResponse, 0, len(items))
		for _, c := range items {
			out = append(out, channelToResponse(c))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateChannel(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			Name   string          `json:"name"`
			Kind   string          `json:"kind"`
			Config json.RawMessage `json:"config,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" || req.Kind == "" {
			writeBadRequest(w, r, "name and kind are required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateNotificationChannel(r.Context(), &store.NotificationChannel{
			TenantID: tenant.ID, Name: req.Name, Kind: req.Kind, Config: string(req.Config), Enabled: true,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrNotificationChannelTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"A channel with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create channel")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, channelToResponse(created))
	}
}

func handleGetChannel(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		c, err := tx.GetNotificationChannel(r.Context(), tenant.ID, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Channel not found",
				"No channel with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, channelToResponse(c))
	}
}

func handleUpdateChannel(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		var req struct {
			Name    *string          `json:"name,omitempty"`
			Kind    *string          `json:"kind,omitempty"`
			Config  *json.RawMessage `json:"config,omitempty"`
			Enabled *bool            `json:"enabled,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		params := store.UpdateNotificationChannelParams{
			Name: req.Name, Kind: req.Kind, Enabled: req.Enabled,
		}
		if req.Config != nil {
			s := string(*req.Config)
			params.Config = &s
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateNotificationChannel(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrNotificationChannelNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Channel not found",
					"No channel with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update channel")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, channelToResponse(updated))
	}
}

func handleDeleteChannel(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteNotificationChannel(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrNotificationChannelNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Channel not found",
					"No channel with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete channel")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleTestChannel(st store.Driver) http.HandlerFunc {
	// Resolves the stored channel, runs a single dispatch through the
	// channel-send dispatcher (with retry + delivery-log writes), and
	// returns the result. Used by the admin panel "Send test" button.
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")

		tx, err := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		if err != nil {
			writeInternalError(w, r, "begin tx")
			return
		}
		ch, err := tx.GetNotificationChannel(r.Context(), tenant.ID, id)
		_ = tx.Rollback()
		if err != nil {
			if errors.Is(err, store.ErrNotificationChannelNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Channel not found",
					"No notification channel with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "get channel")
			return
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
			writeProblem(w, http.StatusBadGateway, errTypeBadGateway, "Channel test delivery failed",
				sendErr.Error(), r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
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

func handleListRules(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListRoutingRulesByTenant(r.Context(), tenant.ID)
		if err != nil {
			writeInternalError(w, r, "list rules")
			return
		}
		out := make([]routingRuleResponse, 0, len(items))
		for _, rl := range items {
			out = append(out, routingRuleToResponse(rl))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleCreateRule(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			Name        string          `json:"name"`
			EventFilter json.RawMessage `json:"eventFilter,omitempty"`
			ChannelIDs  json.RawMessage `json:"channelIds,omitempty"`
			OrderHint   int32           `json:"orderHint,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.Name == "" {
			writeBadRequest(w, r, "name is required")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		created, err := tx.CreateRoutingRule(r.Context(), &store.NotificationRoutingRule{
			TenantID: tenant.ID, Name: req.Name, EventFilter: string(req.EventFilter),
			ChannelIDs: string(req.ChannelIDs), Enabled: true, OrderHint: req.OrderHint,
		})
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrRoutingRuleNameTaken) {
				writeProblem(w, http.StatusConflict, errTypeConflict, "Name already in use",
					"A routing rule with that name already exists in this tenant", r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "create rule")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusCreated, routingRuleToResponse(created))
	}
}

func handleGetRule(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		rule, err := tx.GetRoutingRule(r.Context(), tenant.ID, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Routing rule not found",
				"No rule with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, routingRuleToResponse(rule))
	}
}

func handleUpdateRule(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
			writeBadRequest(w, r, "invalid JSON body")
			return
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
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpdateRoutingRule(r.Context(), tenant.ID, id, params)
		if err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrRoutingRuleNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Routing rule not found",
					"No rule with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "update rule")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, routingRuleToResponse(updated))
	}
}

func handleDeleteRule(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.DeleteRoutingRule(r.Context(), tenant.ID, id); err != nil {
			_ = tx.Rollback()
			if errors.Is(err, store.ErrRoutingRuleNotFound) {
				writeProblem(w, http.StatusNotFound, errTypeNotFound, "Routing rule not found",
					"No rule with id "+id, r.URL.Path, nil)
				return
			}
			writeInternalError(w, r, "delete rule")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func handleReorderRules(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			OrderedIDs []string `json:"orderedIds"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		if err := tx.ReorderRoutingRules(r.Context(), tenant.ID, req.OrderedIDs); err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "reorder")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

// ─── Delivery log handlers ──────────────────────────────────────────────────

func handleListDeliveryLog(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
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
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		items, err := tx.ListDeliveryLogByTenant(r.Context(), tenant.ID, q)
		if err != nil {
			writeInternalError(w, r, "list log")
			return
		}
		out := make([]deliveryLogResponse, 0, len(items))
		for _, e := range items {
			out = append(out, deliveryLogToResponse(e))
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": out, "total": len(out)})
	}
}

func handleGetDeliveryLog(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		id := r.PathValue("id")
		tx, _ := st.Begin(r.Context(), store.TxOptions{ReadOnly: true})
		defer func() { _ = tx.Rollback() }()
		e, err := tx.GetDeliveryLogEntry(r.Context(), tenant.ID, id)
		if err != nil {
			writeProblem(w, http.StatusNotFound, errTypeNotFound, "Delivery log entry not found",
				"No entry with id "+id, r.URL.Path, nil)
			return
		}
		writeJSON(w, http.StatusOK, deliveryLogToResponse(e))
	}
}

// ─── Tenant config handlers ─────────────────────────────────────────────────

func handleGetTenantNotifConfig(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		handleReadConfig(w, r, st, "get config",
			func(ctx context.Context, tx store.Tx, tenantID string) (any, error) {
				c, err := tx.GetTenantNotificationConfig(ctx, tenantID)
				if err != nil {
					return nil, err
				}
				return tenantNotifConfigToResponse(c), nil
			})
	}
}

func handleUpdateTenantNotifConfig(st store.Driver) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		tenant, ok := tenantOrError(w, r)
		if !ok {
			return
		}
		var req struct {
			Enabled             bool            `json:"enabled"`
			OptInMode           string          `json:"optInMode"`
			MaxRetries          int32           `json:"maxRetries"`
			RetryBackoffSeconds int32           `json:"retryBackoffSeconds"`
			ChannelPriority     json.RawMessage `json:"channelPriority,omitempty"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeBadRequest(w, r, "invalid JSON body")
			return
		}
		if req.OptInMode == "" {
			req.OptInMode = "opt-in"
		}
		tx, _ := st.Begin(r.Context(), store.TxOptions{})
		updated, err := tx.UpsertTenantNotificationConfig(r.Context(), &store.TenantNotificationConfig{
			TenantID: tenant.ID, Enabled: req.Enabled, OptInMode: req.OptInMode,
			MaxRetries: req.MaxRetries, RetryBackoffSeconds: req.RetryBackoffSeconds,
			ChannelPriority: string(req.ChannelPriority),
		})
		if err != nil {
			_ = tx.Rollback()
			writeInternalError(w, r, "upsert config")
			return
		}
		if err := tx.Commit(); err != nil {
			writeInternalError(w, r, "commit")
			return
		}
		writeJSON(w, http.StatusOK, tenantNotifConfigToResponse(updated))
	}
}
