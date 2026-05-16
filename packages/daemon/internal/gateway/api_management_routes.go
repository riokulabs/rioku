package gateway

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/riokulabs/rioku/internal/gateway/optionsutil"
	"github.com/riokulabs/rioku/internal/rerr"
	"github.com/riokulabs/rioku/internal/store"
)

// RegisterAPIManagementRoutes registers REST endpoints for Plans,
// Applications, and Subscriptions under /api/v1/t/{tenant}/... paths.
// All endpoints are permission-gated:
//   - List / Get require "api_management:read"
//   - Create / Update / Delete require "api_management:manage"
func RegisterAPIManagementRoutes(mux *http.ServeMux, st store.Driver) {
	// Plans
	listPlansH := RequirePermission("api_management:read")(rerr.H(handleListPlans(st)))
	createPlanH := RequirePermission("api_management:manage")(rerr.H(handleCreatePlan(st)))
	getPlanH := RequirePermission("api_management:read")(rerr.H(handleGetPlan(st)))
	putPlanH := RequirePermission("api_management:manage")(rerr.H(handleUpdatePlan(st)))
	patchPlanH := RequirePermission("api_management:manage")(rerr.H(handleUpdatePlan(st)))
	deletePlanH := RequirePermission("api_management:manage")(rerr.H(handleDeletePlan(st)))

	// Applications
	listAppsH := RequirePermission("api_management:read")(rerr.H(handleListApplications(st)))
	createAppH := RequirePermission("api_management:manage")(rerr.H(handleCreateApplication(st)))
	getAppH := RequirePermission("api_management:read")(rerr.H(handleGetApplication(st)))
	putAppH := RequirePermission("api_management:manage")(rerr.H(handleUpdateApplication(st)))
	patchAppH := RequirePermission("api_management:manage")(rerr.H(handleUpdateApplication(st)))
	deleteAppH := RequirePermission("api_management:manage")(rerr.H(handleDeleteApplication(st)))

	// Subscriptions
	listSubsH := RequirePermission("api_management:read")(rerr.H(handleListSubscriptions(st)))
	createSubH := RequirePermission("api_management:manage")(rerr.H(handleCreateSubscription(st)))
	getSubH := RequirePermission("api_management:read")(rerr.H(handleGetSubscription(st)))
	putSubH := RequirePermission("api_management:manage")(rerr.H(handleUpdateSubscription(st)))
	patchSubH := RequirePermission("api_management:manage")(rerr.H(handleUpdateSubscription(st)))
	deleteSubH := RequirePermission("api_management:manage")(rerr.H(handleDeleteSubscription(st)))

	base := "/api/v1/t/{tenant}"

	// --- Plans ---
	mux.Handle("GET "+base+"/plans", listPlansH)
	mux.Handle("POST "+base+"/plans", createPlanH)
	mux.Handle("GET "+base+"/plans/{id}", getPlanH)
	mux.Handle("PUT "+base+"/plans/{id}", putPlanH)
	mux.Handle("PATCH "+base+"/plans/{id}", patchPlanH)
	mux.Handle("DELETE "+base+"/plans/{id}", deletePlanH)
	optionsutil.Register(mux, base+"/plans", []string{"GET", "POST"})
	optionsutil.Register(mux, base+"/plans/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})

	// --- Applications ---
	mux.Handle("GET "+base+"/applications", listAppsH)
	mux.Handle("POST "+base+"/applications", createAppH)
	mux.Handle("GET "+base+"/applications/{id}", getAppH)
	mux.Handle("PUT "+base+"/applications/{id}", putAppH)
	mux.Handle("PATCH "+base+"/applications/{id}", patchAppH)
	mux.Handle("DELETE "+base+"/applications/{id}", deleteAppH)
	optionsutil.Register(mux, base+"/applications", []string{"GET", "POST"})
	optionsutil.Register(mux, base+"/applications/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})

	// --- Subscriptions ---
	mux.Handle("GET "+base+"/subscriptions", listSubsH)
	mux.Handle("POST "+base+"/subscriptions", createSubH)
	mux.Handle("GET "+base+"/subscriptions/{id}", getSubH)
	mux.Handle("PUT "+base+"/subscriptions/{id}", putSubH)
	mux.Handle("PATCH "+base+"/subscriptions/{id}", patchSubH)
	mux.Handle("DELETE "+base+"/subscriptions/{id}", deleteSubH)
	optionsutil.Register(mux, base+"/subscriptions", []string{"GET", "POST"})
	optionsutil.Register(mux, base+"/subscriptions/{id}", []string{"GET", "PUT", "PATCH", "DELETE"})
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type planResponse struct {
	ID                 string `json:"id"`
	TenantID           string `json:"tenantId"`
	APIID              string `json:"apiId"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	SecurityType       string `json:"securityType"`
	Validation         string `json:"validation"`
	Status             string `json:"status"`
	RateLimitPerMinute int32  `json:"rateLimitPerMinute"`
	QuotaPerDay        int32  `json:"quotaPerDay"`
	SelectionRule      string `json:"selectionRule"`
	CreatedAt          string `json:"createdAt"`
	UpdatedAt          string `json:"updatedAt"`
}

func toPlanResponse(p *store.Plan) planResponse {
	return planResponse{
		ID:                 p.ID,
		TenantID:           p.TenantID,
		APIID:              p.APIID,
		Name:               p.Name,
		Description:        p.Description,
		SecurityType:       string(p.SecurityType),
		Validation:         string(p.Validation),
		Status:             string(p.Status),
		RateLimitPerMinute: p.RateLimitPerMinute,
		QuotaPerDay:        p.QuotaPerDay,
		SelectionRule:      p.SelectionRule,
		CreatedAt:          p.CreatedAt.Format(time.RFC3339),
		UpdatedAt:          p.UpdatedAt.Format(time.RFC3339),
	}
}

type applicationResponse struct {
	ID          string  `json:"id"`
	TenantID    string  `json:"tenantId"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	OwnerUserID *string `json:"ownerUserId,omitempty"`
	Status      string  `json:"status"`
	CreatedAt   string  `json:"createdAt"`
	UpdatedAt   string  `json:"updatedAt"`
}

func toApplicationResponse(a *store.Application) applicationResponse {
	return applicationResponse{
		ID:          a.ID,
		TenantID:    a.TenantID,
		Name:        a.Name,
		Description: a.Description,
		OwnerUserID: a.OwnerUserID,
		Status:      string(a.Status),
		CreatedAt:   a.CreatedAt.Format(time.RFC3339),
		UpdatedAt:   a.UpdatedAt.Format(time.RFC3339),
	}
}

type subscriptionResponse struct {
	ID             string  `json:"id"`
	TenantID       string  `json:"tenantId"`
	PlanID         string  `json:"planId"`
	ApplicationID  string  `json:"applicationId"`
	APIID          string  `json:"apiId"`
	Status         string  `json:"status"`
	RequestMessage string  `json:"requestMessage"`
	ReasonMessage  string  `json:"reasonMessage"`
	StartingAt     *string `json:"startingAt,omitempty"`
	EndingAt       *string `json:"endingAt,omitempty"`
	CreatedAt      string  `json:"createdAt"`
	UpdatedAt      string  `json:"updatedAt"`
}

func toSubscriptionResponse(s *store.Subscription) subscriptionResponse {
	resp := subscriptionResponse{
		ID:             s.ID,
		TenantID:       s.TenantID,
		PlanID:         s.PlanID,
		ApplicationID:  s.ApplicationID,
		APIID:          s.APIID,
		Status:         string(s.Status),
		RequestMessage: s.RequestMessage,
		ReasonMessage:  s.ReasonMessage,
		CreatedAt:      s.CreatedAt.Format(time.RFC3339),
		UpdatedAt:      s.UpdatedAt.Format(time.RFC3339),
	}
	if s.StartingAt != nil {
		t := s.StartingAt.Format(time.RFC3339)
		resp.StartingAt = &t
	}
	if s.EndingAt != nil {
		t := s.EndingAt.Format(time.RFC3339)
		resp.EndingAt = &t
	}
	return resp
}

// ---------------------------------------------------------------------------
// Plan handlers
// ---------------------------------------------------------------------------

func handleListPlans(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		plans, err := tx.ListPlans(ctx)
		if err != nil {
			return rerr.Wrap(err, "list plans")
		}

		result := make([]planResponse, 0, len(plans))
		for _, p := range plans {
			result = append(result, toPlanResponse(p))
		}

		return rerr.JSON(w, map[string]any{
			"plans":         result,
			"nextPageToken": "",
		})
	}
}

type createPlanRequest struct {
	APIID              string `json:"apiId"`
	Name               string `json:"name"`
	Description        string `json:"description"`
	SecurityType       string `json:"securityType"`
	Validation         string `json:"validation"`
	RateLimitPerMinute int32  `json:"rateLimitPerMinute"`
	QuotaPerDay        int32  `json:"quotaPerDay"`
	SelectionRule      string `json:"selectionRule"`
}

func handleCreatePlan(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req createPlanRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		if req.Name == "" {
			return rerr.Validation(map[string]string{"name": "must not be empty"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		plan, err := tx.CreatePlan(ctx, store.CreatePlanParams{
			ID:                 uuid.New().String(),
			APIID:              req.APIID,
			Name:               req.Name,
			Description:        req.Description,
			SecurityType:       store.PlanSecurityType(req.SecurityType),
			Validation:         store.PlanValidation(req.Validation),
			RateLimitPerMinute: req.RateLimitPerMinute,
			QuotaPerDay:        req.QuotaPerDay,
			SelectionRule:      req.SelectionRule,
		})
		if err != nil {
			if errors.Is(err, store.ErrPlanNameTaken) {
				return rerr.Conflict("a plan with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create plan")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, toPlanResponse(plan))
	}
}

func handleGetPlan(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "plan ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		plan, err := tx.GetPlan(ctx, id)
		if err != nil {
			if errors.Is(err, store.ErrPlanNotFound) {
				return rerr.NotFound("plan", id)
			}
			return rerr.Wrap(err, "get plan")
		}

		return rerr.JSON(w, toPlanResponse(plan))
	}
}

type updatePlanRequest struct {
	Name               *string `json:"name"`
	Description        *string `json:"description"`
	SecurityType       *string `json:"securityType"`
	Validation         *string `json:"validation"`
	RateLimitPerMinute *int32  `json:"rateLimitPerMinute"`
	QuotaPerDay        *int32  `json:"quotaPerDay"`
	SelectionRule      *string `json:"selectionRule"`
}

func handleUpdatePlan(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "plan ID is required"})
		}

		var req updatePlanRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		params := store.UpdatePlanParams{
			Name:               req.Name,
			Description:        req.Description,
			RateLimitPerMinute: req.RateLimitPerMinute,
			QuotaPerDay:        req.QuotaPerDay,
			SelectionRule:      req.SelectionRule,
		}
		if req.SecurityType != nil {
			st := store.PlanSecurityType(*req.SecurityType)
			params.SecurityType = &st
		}
		if req.Validation != nil {
			v := store.PlanValidation(*req.Validation)
			params.Validation = &v
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		plan, err := tx.UpdatePlan(ctx, id, params)
		if err != nil {
			if errors.Is(err, store.ErrPlanNotFound) {
				return rerr.NotFound("plan", id)
			}
			if errors.Is(err, store.ErrPlanNameTaken) {
				return rerr.Conflict("a plan with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "update plan")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, toPlanResponse(plan))
	}
}

func handleDeletePlan(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "plan ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.DeletePlan(ctx, id); err != nil {
			if errors.Is(err, store.ErrPlanNotFound) {
				return rerr.NotFound("plan", id)
			}
			return rerr.Wrap(err, "delete plan")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ---------------------------------------------------------------------------
// Application handlers
// ---------------------------------------------------------------------------

func handleListApplications(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		apps, err := tx.ListApplications(ctx)
		if err != nil {
			return rerr.Wrap(err, "list applications")
		}

		result := make([]applicationResponse, 0, len(apps))
		for _, a := range apps {
			result = append(result, toApplicationResponse(a))
		}

		return rerr.JSON(w, map[string]any{
			"applications":  result,
			"nextPageToken": "",
		})
	}
}

type createApplicationRequest struct {
	Name        string  `json:"name"`
	Description string  `json:"description"`
	OwnerUserID *string `json:"ownerUserId"`
}

func handleCreateApplication(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req createApplicationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		if req.Name == "" {
			return rerr.Validation(map[string]string{"name": "must not be empty"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		app, err := tx.CreateApplication(ctx, store.CreateApplicationParams{
			ID:          uuid.New().String(),
			Name:        req.Name,
			Description: req.Description,
			OwnerUserID: req.OwnerUserID,
		})
		if err != nil {
			if errors.Is(err, store.ErrApplicationNameTaken) {
				return rerr.Conflict("an application with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "create application")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, toApplicationResponse(app))
	}
}

func handleGetApplication(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "application ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		app, err := tx.GetApplication(ctx, id)
		if err != nil {
			if errors.Is(err, store.ErrApplicationNotFound) {
				return rerr.NotFound("application", id)
			}
			return rerr.Wrap(err, "get application")
		}

		return rerr.JSON(w, toApplicationResponse(app))
	}
}

type updateApplicationRequest struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	OwnerUserID *string `json:"ownerUserId"`
	ClearOwner  bool    `json:"clearOwner"`
}

func handleUpdateApplication(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "application ID is required"})
		}

		var req updateApplicationRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		app, err := tx.UpdateApplication(ctx, id, store.UpdateApplicationParams{
			Name:        req.Name,
			Description: req.Description,
			OwnerUserID: req.OwnerUserID,
			SetOwnerNil: req.ClearOwner,
		})
		if err != nil {
			if errors.Is(err, store.ErrApplicationNotFound) {
				return rerr.NotFound("application", id)
			}
			if errors.Is(err, store.ErrApplicationNameTaken) {
				return rerr.Conflict("an application with that name already exists in this tenant", err)
			}
			return rerr.Wrap(err, "update application")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, toApplicationResponse(app))
	}
}

func handleDeleteApplication(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "application ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		if err := tx.DeleteApplication(ctx, id); err != nil {
			if errors.Is(err, store.ErrApplicationNotFound) {
				return rerr.NotFound("application", id)
			}
			return rerr.Wrap(err, "delete application")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}

// ---------------------------------------------------------------------------
// Subscription handlers
// ---------------------------------------------------------------------------

func handleListSubscriptions(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		var subs []*store.Subscription
		applicationID := r.URL.Query().Get("application_id")
		planID := r.URL.Query().Get("plan_id")

		switch {
		case applicationID != "":
			subs, err = tx.ListSubscriptionsByApplication(ctx, applicationID)
		case planID != "":
			subs, err = tx.ListSubscriptionsByPlan(ctx, planID)
		default:
			subs, err = tx.ListSubscriptions(ctx)
		}
		if err != nil {
			return rerr.Wrap(err, "list subscriptions")
		}

		result := make([]subscriptionResponse, 0, len(subs))
		for _, s := range subs {
			result = append(result, toSubscriptionResponse(s))
		}

		return rerr.JSON(w, map[string]any{
			"subscriptions": result,
			"nextPageToken": "",
		})
	}
}

type createSubscriptionRequest struct {
	PlanID         string `json:"planId"`
	ApplicationID  string `json:"applicationId"`
	APIID          string `json:"apiId"`
	RequestMessage string `json:"requestMessage"`
}

func handleCreateSubscription(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()

		var req createSubscriptionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		if req.PlanID == "" {
			return rerr.Validation(map[string]string{"planId": "must not be empty"})
		}
		if req.ApplicationID == "" {
			return rerr.Validation(map[string]string{"applicationId": "must not be empty"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		sub, err := tx.CreateSubscription(ctx, store.CreateSubscriptionParams{
			ID:             uuid.New().String(),
			PlanID:         req.PlanID,
			ApplicationID:  req.ApplicationID,
			APIID:          req.APIID,
			RequestMessage: req.RequestMessage,
		})
		if err != nil {
			if errors.Is(err, store.ErrSubscriptionDuplicate) {
				return rerr.Conflict("a live subscription already exists for this application and plan", err)
			}
			return rerr.Wrap(err, "create subscription")
		}

		// Auto-transition to accepted when the plan's validation is "auto".
		plan, planErr := tx.GetPlan(ctx, req.PlanID)
		if planErr == nil && plan.Validation == store.PlanValidationAuto {
			if transitioned, transErr := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusAccepted, ""); transErr == nil {
				sub = transitioned
			}
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSONStatus(w, http.StatusCreated, toSubscriptionResponse(sub))
	}
}

func handleGetSubscription(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "subscription ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{ReadOnly: true})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		sub, err := tx.GetSubscription(ctx, id)
		if err != nil {
			if errors.Is(err, store.ErrSubscriptionNotFound) {
				return rerr.NotFound("subscription", id)
			}
			return rerr.Wrap(err, "get subscription")
		}

		return rerr.JSON(w, toSubscriptionResponse(sub))
	}
}

type updateSubscriptionRequest struct {
	RequestMessage  *string `json:"requestMessage"`
	ReasonMessage   *string `json:"reasonMessage"`
	StartingAt      *string `json:"startingAt"`
	EndingAt        *string `json:"endingAt"`
	ClearStartingAt bool    `json:"clearStartingAt"`
	ClearEndingAt   bool    `json:"clearEndingAt"`
}

func handleUpdateSubscription(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		r.Body = http.MaxBytesReader(w, r.Body, maxAuthBodySize)
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "subscription ID is required"})
		}

		var req updateSubscriptionRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			return rerr.Validation(map[string]string{"body": "invalid JSON body"})
		}

		params := store.UpdateSubscriptionParams{
			RequestMessage:  req.RequestMessage,
			ReasonMessage:   req.ReasonMessage,
			ClearStartingAt: req.ClearStartingAt,
			ClearEndingAt:   req.ClearEndingAt,
		}

		if req.StartingAt != nil {
			t, err := time.Parse(time.RFC3339, *req.StartingAt)
			if err != nil {
				return rerr.Validation(map[string]string{"startingAt": "must be RFC3339 timestamp"})
			}
			params.StartingAt = &t
		}
		if req.EndingAt != nil {
			t, err := time.Parse(time.RFC3339, *req.EndingAt)
			if err != nil {
				return rerr.Validation(map[string]string{"endingAt": "must be RFC3339 timestamp"})
			}
			params.EndingAt = &t
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		sub, err := tx.UpdateSubscription(ctx, id, params)
		if err != nil {
			if errors.Is(err, store.ErrSubscriptionNotFound) {
				return rerr.NotFound("subscription", id)
			}
			return rerr.Wrap(err, "update subscription")
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		return rerr.JSON(w, toSubscriptionResponse(sub))
	}
}

func handleDeleteSubscription(st store.Driver) rerr.Handler {
	return func(w http.ResponseWriter, r *http.Request) error {
		ctx := r.Context()
		id := r.PathValue("id")
		if id == "" {
			return rerr.Validation(map[string]string{"id": "subscription ID is required"})
		}

		tx, err := st.Begin(ctx, store.TxOptions{})
		if err != nil {
			return rerr.Wrap(err, "begin tx")
		}
		defer func() { _ = tx.Rollback() }()

		// Subscriptions are closed via status transition rather than hard
		// delete. Transition to closed (terminal) if the current status
		// allows it; fall back to a raw delete only when the store does not
		// expose a dedicated delete method.
		if _, err := tx.TransitionSubscription(ctx, id, store.SubscriptionStatusClosed, "deleted by operator"); err != nil {
			if errors.Is(err, store.ErrSubscriptionNotFound) {
				return rerr.NotFound("subscription", id)
			}
			if !errors.Is(err, store.ErrSubscriptionInvalidTransition) {
				return rerr.Wrap(err, "close subscription")
			}
			// Already in a terminal state — nothing to do (treat as success).
		}

		if err := tx.Commit(); err != nil {
			return rerr.Wrap(err, "commit")
		}

		w.WriteHeader(http.StatusNoContent)
		return nil
	}
}
