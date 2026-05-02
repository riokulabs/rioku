// Package raft implements the store.Driver interface using hashicorp/raft
// with bbolt as the FSM backing store. This enables zero-dependency
// clustering for small-to-medium deployments (3-7 nodes).
package raft

import (
	"encoding/json"
	"fmt"
)

// CommandOp identifies the type of mutation to apply.
type CommandOp string

const (
	OpCreateRoute   CommandOp = "create_route"
	OpUpdateRoute   CommandOp = "update_route"
	OpDeleteRoute   CommandOp = "delete_route"
	OpCreateService CommandOp = "create_service"
	OpUpdateService CommandOp = "update_service"
	OpDeleteService CommandOp = "delete_service"
	OpCreatePolicy  CommandOp = "create_policy"
	OpUpdatePolicy  CommandOp = "update_policy"
	OpDeletePolicy  CommandOp = "delete_policy"

	OpAttachPolicy CommandOp = "attach_policy"
	OpDetachPolicy CommandOp = "detach_policy"

	OpCreateAPIKey CommandOp = "create_api_key"
	OpRevokeAPIKey CommandOp = "revoke_api_key"

	OpSaveConfigVersion CommandOp = "save_config_version"
	OpAppendAuditEntry  CommandOp = "append_audit_entry"

	// OpBatch wraps a sequence of sub-commands that the FSM applies inside a
	// single bbolt write transaction. If any sub-command returns an error,
	// the entire bbolt tx is rolled back and the raft log entry is committed
	// but observed as a no-op. This is the mechanism that makes raftTx
	// truly transactional — see fix for issue #56.
	//
	// Nested OpBatch is rejected.
	OpBatch CommandOp = "batch"
)

// batchData is the payload for OpBatch.
type batchData struct {
	Commands []Command `json:"commands"`
}

// batchResult is the FSM response payload for OpBatch — one entry per
// sub-command, in the same order they were submitted.
type batchResult struct {
	Results []batchSubResult `json:"results"`
}

type batchSubResult struct {
	Data  []byte `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

// Command is the envelope serialized into each raft log entry.
// The FSM deserializes this and applies the mutation to bbolt.
type Command struct {
	Op   CommandOp       `json:"op"`
	Data json.RawMessage `json:"data"`
}

// CommandResult is returned by FSM.Apply and forwarded back to the caller.
type CommandResult struct {
	Data  []byte `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
}

func encodeCommand(op CommandOp, data any) ([]byte, error) {
	d, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("raft: marshal command data: %w", err)
	}
	return json.Marshal(Command{Op: op, Data: d})
}

// Bucket names in bbolt.
const (
	bucketRoutes             = "routes"
	bucketServices           = "services"
	bucketUpstreams          = "upstreams"
	bucketUpstreamsByService = "upstreams_by_service"
	bucketPolicies           = "policies"
	bucketPolicyBindings     = "policy_bindings"
	bucketAPIKeys            = "api_keys"
	bucketAPIKeysByHash      = "api_keys_by_hash"
	bucketConfigVersions     = "config_versions"
	bucketAuditLog           = "audit_log"
	bucketMeta               = "meta"
)

const metaVersionCounter = "version_counter"

// upstreamIndexSep separates serviceID from upstreamID in the
// bucketUpstreamsByService index key. The character must not appear in
// UUID-shaped IDs so prefix scans by serviceID are unambiguous.
const upstreamIndexSep = "/"

// upstreamIndexKey returns the index key used to map a service to one of
// its upstreams. The key layout is "<serviceID>/<upstreamID>".
//
// Listing all upstreams for a service is a prefix-bounded cursor walk
// using "<serviceID>/" as the seek prefix, which makes ListServices an
// O(N + total_upstreams_for_those_services) operation instead of
// O(N * total_upstreams).
func upstreamIndexKey(serviceID, upstreamID string) []byte {
	out := make([]byte, 0, len(serviceID)+len(upstreamIndexSep)+len(upstreamID))
	out = append(out, serviceID...)
	out = append(out, upstreamIndexSep...)
	out = append(out, upstreamID...)
	return out
}

// upstreamIndexPrefix returns the seek prefix for all upstream-index
// entries belonging to a single service.
func upstreamIndexPrefix(serviceID string) []byte {
	out := make([]byte, 0, len(serviceID)+len(upstreamIndexSep))
	out = append(out, serviceID...)
	out = append(out, upstreamIndexSep...)
	return out
}
