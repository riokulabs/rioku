package grpc

import (
	"context"
	"errors"

	"github.com/google/uuid"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// apiManagementService implements riokuv1.APIManagementServiceServer
// (#164, Sprint 4 Phase 1b). REST routes are bound via grpc-gateway
// from packages/proto/rioku/v1/api_management.proto.
//
// State-transition endpoints (TransitionPlan / TransitionApplication
// / TransitionSubscription) call the dedicated Tx transition methods
// rather than UpdateX, so the state machine + audit emission stay
// centralised in the storage layer (#117 / #182 patterns).
type apiManagementService struct {
	riokuv1.UnimplementedAPIManagementServiceServer
	store    store.Driver
	webhooks WebhookEmitter
}

// WebhookEmitter is the narrow surface this service uses to fire
// state-transition webhook events (Sprint 4 Phase 1e). The concrete
// implementation lives in internal/notifications; the gRPC layer
// only depends on the Emit method.
type WebhookEmitter interface {
	Emit(ctx context.Context, event WebhookEvent)
}

// WebhookEvent is the event shape Phase 1e dispatches to operator-
// configured webhook_endpoints. The concrete fan-out lives in the
// notifications subsystem; this struct is the gRPC handler's contract
// to it.
type WebhookEvent struct {
	Type     string         // e.g., "subscription.accepted"
	TenantID string
	Actor    string
	Payload  map[string]any
}

func newAPIManagementService(st store.Driver, hooks WebhookEmitter) *apiManagementService {
	return &apiManagementService{store: st, webhooks: hooks}
}

// SetWebhookEmitter installs (or replaces) the webhook dispatcher.
// The daemon constructs the gRPC server early and wires the
// notifications dispatcher later; this lets the wiring stay loose
// and avoids a circular import via the daemon package.
func (s *apiManagementService) SetWebhookEmitter(e WebhookEmitter) {
	s.webhooks = e
}

// APIManagementWebhookSetter is the narrow interface daemon.Start
// uses to plumb the dispatcher into the gRPC server post-
// construction.
type APIManagementWebhookSetter interface {
	SetWebhookEmitter(WebhookEmitter)
}

// ---- Plans ---------------------------------------------------------------

func (s *apiManagementService) CreatePlan(ctx context.Context, req *riokuv1.CreatePlanRequest) (*riokuv1.Plan, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	id := req.GetId()
	if id == "" {
		id = "plan_" + uuid.NewString()
	}
	plan, err := tx.CreatePlan(ctx, store.CreatePlanParams{
		ID:                 id,
		TenantID:           store.TenantIDFromContext(ctx),
		APIID:              req.GetApiId(),
		Name:               req.GetName(),
		Description:        req.GetDescription(),
		SecurityType:       store.PlanSecurityType(req.GetSecurityType()),
		Validation:         store.PlanValidation(req.GetValidation()),
		RateLimitPerMinute: req.GetRateLimitPerMinute(),
		QuotaPerDay:        req.GetQuotaPerDay(),
		SelectionRule:      req.GetSelectionRule(),
	})
	if err != nil {
		return nil, mapPlanError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	s.fireWebhook(ctx, "plan.created", plan.TenantID, planToPayload(plan))
	return planToProto(plan), nil
}

func (s *apiManagementService) GetPlan(ctx context.Context, req *riokuv1.GetPlanRequest) (*riokuv1.Plan, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	plan, err := tx.GetPlan(ctx, req.GetId())
	if err != nil {
		return nil, mapPlanError(err)
	}
	return planToProto(plan), nil
}

func (s *apiManagementService) ListPlans(ctx context.Context, req *riokuv1.ListPlansRequest) (*riokuv1.ListPlansResponse, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	var plans []*store.Plan
	if req.GetApiId() != "" {
		plans, err = tx.ListPlansByAPI(ctx, req.GetApiId())
	} else {
		plans, err = tx.ListPlans(ctx)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list plans: %v", err)
	}
	out := make([]*riokuv1.Plan, len(plans))
	for i, p := range plans {
		out[i] = planToProto(p)
	}
	return &riokuv1.ListPlansResponse{Plans: out}, nil
}

func (s *apiManagementService) UpdatePlan(ctx context.Context, req *riokuv1.UpdatePlanRequest) (*riokuv1.Plan, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	params := store.UpdatePlanParams{}
	if req.Name != nil {
		v := req.GetName()
		params.Name = &v
	}
	if req.Description != nil {
		v := req.GetDescription()
		params.Description = &v
	}
	if req.SecurityType != nil {
		v := store.PlanSecurityType(req.GetSecurityType())
		params.SecurityType = &v
	}
	if req.Validation != nil {
		v := store.PlanValidation(req.GetValidation())
		params.Validation = &v
	}
	if req.RateLimitPerMinute != nil {
		v := req.GetRateLimitPerMinute()
		params.RateLimitPerMinute = &v
	}
	if req.QuotaPerDay != nil {
		v := req.GetQuotaPerDay()
		params.QuotaPerDay = &v
	}
	if req.SelectionRule != nil {
		v := req.GetSelectionRule()
		params.SelectionRule = &v
	}

	plan, err := tx.UpdatePlan(ctx, req.GetId(), params)
	if err != nil {
		return nil, mapPlanError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return planToProto(plan), nil
}

func (s *apiManagementService) TransitionPlan(ctx context.Context, req *riokuv1.TransitionPlanRequest) (*riokuv1.Plan, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	plan, err := tx.TransitionPlan(ctx, req.GetId(), store.PlanStatus(req.GetStatus()))
	if err != nil {
		return nil, mapPlanError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	s.fireWebhook(ctx, "plan."+string(plan.Status), plan.TenantID, planToPayload(plan))
	return planToProto(plan), nil
}

func (s *apiManagementService) DeletePlan(ctx context.Context, req *riokuv1.DeletePlanRequest) (*riokuv1.MutationMeta, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := tx.DeletePlan(ctx, req.GetId()); err != nil {
		return nil, mapPlanError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return &riokuv1.MutationMeta{Actor: actorFrom(ctx), MutatedAt: timestamppb.Now()}, nil
}

// ---- Applications ---------------------------------------------------------

func (s *apiManagementService) CreateApplication(ctx context.Context, req *riokuv1.CreateApplicationRequest) (*riokuv1.Application, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	id := req.GetId()
	if id == "" {
		id = "app_" + uuid.NewString()
	}
	var owner *string
	if v := req.GetOwnerUserId(); v != "" {
		owner = &v
	}
	app, err := tx.CreateApplication(ctx, store.CreateApplicationParams{
		ID:          id,
		TenantID:    store.TenantIDFromContext(ctx),
		Name:        req.GetName(),
		Description: req.GetDescription(),
		OwnerUserID: owner,
	})
	if err != nil {
		return nil, mapApplicationError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	s.fireWebhook(ctx, "application.created", app.TenantID, applicationToPayload(app))
	return applicationToProto(app), nil
}

func (s *apiManagementService) GetApplication(ctx context.Context, req *riokuv1.GetApplicationRequest) (*riokuv1.Application, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	app, err := tx.GetApplication(ctx, req.GetId())
	if err != nil {
		return nil, mapApplicationError(err)
	}
	return applicationToProto(app), nil
}

func (s *apiManagementService) ListApplications(ctx context.Context, _ *riokuv1.ListApplicationsRequest) (*riokuv1.ListApplicationsResponse, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	apps, err := tx.ListApplications(ctx)
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list applications: %v", err)
	}
	out := make([]*riokuv1.Application, len(apps))
	for i, a := range apps {
		out[i] = applicationToProto(a)
	}
	return &riokuv1.ListApplicationsResponse{Applications: out}, nil
}

func (s *apiManagementService) UpdateApplication(ctx context.Context, req *riokuv1.UpdateApplicationRequest) (*riokuv1.Application, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	params := store.UpdateApplicationParams{}
	if req.Name != nil {
		v := req.GetName()
		params.Name = &v
	}
	if req.Description != nil {
		v := req.GetDescription()
		params.Description = &v
	}
	if req.GetClearOwner() {
		params.SetOwnerNil = true
	} else if req.OwnerUserId != nil {
		v := req.GetOwnerUserId()
		params.OwnerUserID = &v
	}

	app, err := tx.UpdateApplication(ctx, req.GetId(), params)
	if err != nil {
		return nil, mapApplicationError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return applicationToProto(app), nil
}

func (s *apiManagementService) TransitionApplication(ctx context.Context, req *riokuv1.TransitionApplicationRequest) (*riokuv1.Application, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	app, err := tx.TransitionApplication(ctx, req.GetId(), store.ApplicationStatus(req.GetStatus()))
	if err != nil {
		return nil, mapApplicationError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	s.fireWebhook(ctx, "application."+string(app.Status), app.TenantID, applicationToPayload(app))
	return applicationToProto(app), nil
}

func (s *apiManagementService) DeleteApplication(ctx context.Context, req *riokuv1.DeleteApplicationRequest) (*riokuv1.MutationMeta, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	if err := tx.DeleteApplication(ctx, req.GetId()); err != nil {
		return nil, mapApplicationError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return &riokuv1.MutationMeta{Actor: actorFrom(ctx), MutatedAt: timestamppb.Now()}, nil
}

// ---- Subscriptions --------------------------------------------------------

func (s *apiManagementService) CreateSubscription(ctx context.Context, req *riokuv1.CreateSubscriptionRequest) (*riokuv1.Subscription, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	id := req.GetId()
	if id == "" {
		id = "sub_" + uuid.NewString()
	}
	sub, err := tx.CreateSubscription(ctx, store.CreateSubscriptionParams{
		ID:             id,
		TenantID:       store.TenantIDFromContext(ctx),
		PlanID:         req.GetPlanId(),
		ApplicationID:  req.GetApplicationId(),
		APIID:          req.GetApiId(),
		RequestMessage: req.GetRequestMessage(),
	})
	if err != nil {
		return nil, mapSubscriptionError(err)
	}

	// Auto-validation: if the parent plan's Validation is auto, flip
	// the new subscription straight to accepted in the same tx.
	plan, err := tx.GetPlan(ctx, sub.PlanID)
	if err == nil && plan.Validation == store.PlanValidationAuto {
		if accepted, err := tx.TransitionSubscription(ctx, sub.ID, store.SubscriptionStatusAccepted, "auto-accepted (plan validation=auto)"); err == nil {
			sub = accepted
		}
	}

	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	s.fireWebhook(ctx, "subscription.created", sub.TenantID, subscriptionToPayload(sub))
	if sub.Status == store.SubscriptionStatusAccepted {
		s.fireWebhook(ctx, "subscription.accepted", sub.TenantID, subscriptionToPayload(sub))
	}
	return subscriptionToProto(sub), nil
}

func (s *apiManagementService) GetSubscription(ctx context.Context, req *riokuv1.GetSubscriptionRequest) (*riokuv1.Subscription, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	sub, err := tx.GetSubscription(ctx, req.GetId())
	if err != nil {
		return nil, mapSubscriptionError(err)
	}
	return subscriptionToProto(sub), nil
}

func (s *apiManagementService) ListSubscriptions(ctx context.Context, req *riokuv1.ListSubscriptionsRequest) (*riokuv1.ListSubscriptionsResponse, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{ReadOnly: true})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	var subs []*store.Subscription
	switch {
	case req.GetApplicationId() != "":
		subs, err = tx.ListSubscriptionsByApplication(ctx, req.GetApplicationId())
	case req.GetPlanId() != "":
		subs, err = tx.ListSubscriptionsByPlan(ctx, req.GetPlanId())
	default:
		subs, err = tx.ListSubscriptions(ctx)
	}
	if err != nil {
		return nil, status.Errorf(codes.Internal, "list subscriptions: %v", err)
	}
	out := make([]*riokuv1.Subscription, len(subs))
	for i, s := range subs {
		out[i] = subscriptionToProto(s)
	}
	return &riokuv1.ListSubscriptionsResponse{Subscriptions: out}, nil
}

func (s *apiManagementService) UpdateSubscription(ctx context.Context, req *riokuv1.UpdateSubscriptionRequest) (*riokuv1.Subscription, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	params := store.UpdateSubscriptionParams{}
	if req.RequestMessage != nil {
		v := req.GetRequestMessage()
		params.RequestMessage = &v
	}
	if req.ReasonMessage != nil {
		v := req.GetReasonMessage()
		params.ReasonMessage = &v
	}
	if req.GetClearStartingAt() {
		params.ClearStartingAt = true
	} else if req.GetStartingAt() != nil {
		t := req.GetStartingAt().AsTime()
		params.StartingAt = &t
	}
	if req.GetClearEndingAt() {
		params.ClearEndingAt = true
	} else if req.GetEndingAt() != nil {
		t := req.GetEndingAt().AsTime()
		params.EndingAt = &t
	}

	sub, err := tx.UpdateSubscription(ctx, req.GetId(), params)
	if err != nil {
		return nil, mapSubscriptionError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	return subscriptionToProto(sub), nil
}

func (s *apiManagementService) TransitionSubscription(ctx context.Context, req *riokuv1.TransitionSubscriptionRequest) (*riokuv1.Subscription, error) {
	tx, err := s.store.Begin(ctx, store.TxOptions{})
	if err != nil {
		return nil, status.Errorf(codes.Internal, "begin tx: %v", err)
	}
	defer func() { _ = tx.Rollback() }()

	sub, err := tx.TransitionSubscription(ctx, req.GetId(), store.SubscriptionStatus(req.GetStatus()), req.GetReason())
	if err != nil {
		return nil, mapSubscriptionError(err)
	}
	if err := tx.Commit(); err != nil {
		return nil, status.Errorf(codes.Internal, "commit: %v", err)
	}
	s.fireWebhook(ctx, "subscription."+string(sub.Status), sub.TenantID, subscriptionToPayload(sub))
	return subscriptionToProto(sub), nil
}

// ---- helpers --------------------------------------------------------------

func (s *apiManagementService) fireWebhook(ctx context.Context, eventType, tenantID string, payload map[string]any) {
	if s.webhooks == nil {
		return
	}
	s.webhooks.Emit(ctx, WebhookEvent{
		Type:     eventType,
		TenantID: tenantID,
		Actor:    actorFrom(ctx),
		Payload:  payload,
	})
}

func actorFrom(ctx context.Context) string {
	if claims := ClaimsFromContext(ctx); claims != nil {
		return claims.Subject
	}
	return "anonymous"
}

func planToProto(p *store.Plan) *riokuv1.Plan {
	if p == nil {
		return nil
	}
	return &riokuv1.Plan{
		Id:                 p.ID,
		TenantId:           p.TenantID,
		ApiId:              p.APIID,
		Name:               p.Name,
		Description:        p.Description,
		SecurityType:       string(p.SecurityType),
		Validation:         string(p.Validation),
		Status:             string(p.Status),
		RateLimitPerMinute: p.RateLimitPerMinute,
		QuotaPerDay:        p.QuotaPerDay,
		SelectionRule:      p.SelectionRule,
		CreatedAt:          timestamppb.New(p.CreatedAt),
		UpdatedAt:          timestamppb.New(p.UpdatedAt),
	}
}

func planToPayload(p *store.Plan) map[string]any {
	return map[string]any{
		"id":            p.ID,
		"tenant_id":     p.TenantID,
		"api_id":        p.APIID,
		"name":          p.Name,
		"status":        string(p.Status),
		"security_type": string(p.SecurityType),
	}
}

func applicationToProto(a *store.Application) *riokuv1.Application {
	if a == nil {
		return nil
	}
	out := &riokuv1.Application{
		Id:          a.ID,
		TenantId:    a.TenantID,
		Name:        a.Name,
		Description: a.Description,
		Status:      string(a.Status),
		CreatedAt:   timestamppb.New(a.CreatedAt),
		UpdatedAt:   timestamppb.New(a.UpdatedAt),
	}
	if a.OwnerUserID != nil {
		out.OwnerUserId = *a.OwnerUserID
	}
	return out
}

func applicationToPayload(a *store.Application) map[string]any {
	out := map[string]any{
		"id":        a.ID,
		"tenant_id": a.TenantID,
		"name":      a.Name,
		"status":    string(a.Status),
	}
	if a.OwnerUserID != nil {
		out["owner_user_id"] = *a.OwnerUserID
	}
	return out
}

func subscriptionToProto(s *store.Subscription) *riokuv1.Subscription {
	if s == nil {
		return nil
	}
	out := &riokuv1.Subscription{
		Id:             s.ID,
		TenantId:       s.TenantID,
		PlanId:         s.PlanID,
		ApplicationId:  s.ApplicationID,
		ApiId:          s.APIID,
		Status:         string(s.Status),
		RequestMessage: s.RequestMessage,
		ReasonMessage:  s.ReasonMessage,
		CreatedAt:      timestamppb.New(s.CreatedAt),
		UpdatedAt:      timestamppb.New(s.UpdatedAt),
	}
	if s.StartingAt != nil {
		out.StartingAt = timestamppb.New(*s.StartingAt)
	}
	if s.EndingAt != nil {
		out.EndingAt = timestamppb.New(*s.EndingAt)
	}
	return out
}

func subscriptionToPayload(s *store.Subscription) map[string]any {
	return map[string]any{
		"id":             s.ID,
		"tenant_id":      s.TenantID,
		"plan_id":        s.PlanID,
		"application_id": s.ApplicationID,
		"api_id":         s.APIID,
		"status":         string(s.Status),
	}
}

// mapPlanError converts store-layer sentinels to gRPC status errors.
// Other errors fall through as Internal.
func mapPlanError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, store.ErrPlanNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, store.ErrPlanNameTaken):
		return status.Error(codes.AlreadyExists, err.Error())
	case errors.Is(err, store.ErrPlanInvalidTransition):
		return status.Error(codes.FailedPrecondition, err.Error())
	}
	return status.Errorf(codes.Internal, "plan: %v", err)
}

func mapApplicationError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, store.ErrApplicationNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, store.ErrApplicationNameTaken):
		return status.Error(codes.AlreadyExists, err.Error())
	case errors.Is(err, store.ErrApplicationInvalidTransition):
		return status.Error(codes.FailedPrecondition, err.Error())
	}
	return status.Errorf(codes.Internal, "application: %v", err)
}

func mapSubscriptionError(err error) error {
	switch {
	case err == nil:
		return nil
	case errors.Is(err, store.ErrSubscriptionNotFound):
		return status.Error(codes.NotFound, err.Error())
	case errors.Is(err, store.ErrSubscriptionDuplicate):
		return status.Error(codes.AlreadyExists, err.Error())
	case errors.Is(err, store.ErrSubscriptionInvalidTransition):
		return status.Error(codes.FailedPrecondition, err.Error())
	}
	return status.Errorf(codes.Internal, "subscription: %v", err)
}
