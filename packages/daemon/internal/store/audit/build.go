package audit

import (
	"fmt"

	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
)

// BuildEntry constructs a fully-populated *riokuv1.AuditEntry from a
// typed Payload. The (discriminator, payload-JSON) pair is produced
// via the registry's Marshal — running any registered Redactor —
// and stamped onto the proto's payload_schema + payload fields.
//
// The actor / entityType / entityID / operation arguments populate
// the existing legacy columns so cross-referencing during the per-
// emitter migration phase works (admin renderer can show both views
// during the transition). Set entityID to a stable identity per
// payload type — for cert.lifecycle_event.v1 use the cert id, for
// raft.leader_change.v1 use the cluster id, etc.
//
// occurredAt is optional: nil sets it to "now" on the storage side.
// Pass a non-nil timestamp for backfill scenarios where the audited
// event happened before the store call.
//
// configVersion is optional: set to 0 for events that aren't tied
// to a config-store mutation (cert lifecycle, raft transitions);
// set to the resolved version for admin actions that produced one.
//
// Returns ErrUnknownSchema (wrapped) when payload's discriminator
// isn't registered. Callers SHOULD register every payload type they
// emit; the function refuses to silently round-trip an unregistered
// payload because the read-side renderer needs the schema to render
// a typed view.
func BuildEntry(
	r *Registry,
	actor, entityType, entityID, operation string,
	payload Payload,
) (*riokuv1.AuditEntry, error) {
	if r == nil {
		return nil, fmt.Errorf("audit: BuildEntry requires non-nil Registry")
	}
	if payload == nil {
		return nil, fmt.Errorf("audit: BuildEntry requires non-nil payload")
	}
	disc, body, err := r.Marshal(payload)
	if err != nil {
		return nil, err
	}
	// Confirm the payload's schema is actually registered. Marshal
	// will succeed for unregistered types (no Redactor lookup
	// available, json.Marshal still works), but we want the typed
	// emitter path to fail fast on unregistered payloads so the
	// admin's read-side renderer never finds an unknown
	// discriminator.
	if _, lookupErr := r.Lookup(disc); lookupErr != nil {
		return nil, lookupErr
	}
	return &riokuv1.AuditEntry{
		Id:            uuid.NewString(),
		Actor:         actor,
		EntityType:    entityType,
		EntityId:      entityID,
		Operation:     operation,
		PayloadSchema: disc,
		Payload:       string(body),
		OccurredAt:    timestamppb.Now(),
	}, nil
}
