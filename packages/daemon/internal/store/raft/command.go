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
)

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
	bucketRoutes         = "routes"
	bucketServices       = "services"
	bucketUpstreams      = "upstreams"
	bucketPolicies       = "policies"
	bucketPolicyBindings = "policy_bindings"
	bucketAPIKeys        = "api_keys"
	bucketAPIKeysByHash  = "api_keys_by_hash"
	bucketConfigVersions = "config_versions"
	bucketAuditLog       = "audit_log"
	bucketMeta           = "meta"
)

const metaVersionCounter = "version_counter"
