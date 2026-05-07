// Adapter glue: lets the config engine call AsyncEvaluateAndDispatch
// without importing the notifications package's domain types.
//
// The engine (internal/config) declares its own AuditEventEnvelope
// shape and an AuditEventDispatchFn callback type. We expose a closure
// factory that translates the engine's envelope into the notifications
// envelope and invokes EventRouter.AsyncEvaluateAndDispatch.
package notifications

import "github.com/riokulabs/rioku/internal/config"

// MakeConfigAuditDispatchFn returns a closure compatible with
// config.AuditEventDispatchFn. Wire this on daemon startup:
//
//	router := notifications.NewEventRouter(store, channelDispatcher, log)
//	engine.SetAuditDispatcher(notifications.MakeConfigAuditDispatchFn(router))
func MakeConfigAuditDispatchFn(router *EventRouter) config.AuditEventDispatchFn {
	if router == nil {
		return nil
	}
	return func(tenantID string, env config.AuditEventEnvelope) {
		router.AsyncEvaluateAndDispatch(tenantID, AuditEnvelope{
			Kind:       env.Kind,
			Category:   env.Category,
			Subtype:    env.Subtype,
			Severity:   env.Severity,
			Subject:    env.Subject,
			Body:       env.Body,
			Actor:      env.Actor,
			EntityType: env.EntityType,
			EntityID:   env.EntityID,
			Extra:      env.Extra,
		})
	}
}
