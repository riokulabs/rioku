package raft

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	riokuv1 "github.com/riokulabs/rioku/proto/gen/go/rioku/v1"
	bolt "go.etcd.io/bbolt"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/riokulabs/rioku/internal/store"
)

const timeFormat = "2006-01-02T15:04:05.000Z"

// raftTx implements store.Tx. Writes go through raft consensus, reads
// come from the local bbolt FSM.
type raftTx struct {
	driver   *Driver
	readOnly bool
	ctx      context.Context
}

func (t *raftTx) Commit() error {
	// Raft commits are per-operation (each apply is atomic).
	// This is a no-op for the raft driver.
	return nil
}

func (t *raftTx) Rollback() error {
	// No rollback support — each operation is individually committed via raft.
	return nil
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

func (t *raftTx) CreateRoute(_ context.Context, route *riokuv1.Route) (*riokuv1.Route, error) {
	id := uuid.New().String()
	now := nowUTC()

	route.Id = id
	route.CreatedAt = timestamppb.New(now)
	route.UpdatedAt = timestamppb.New(now)

	data, err := protojson.Marshal(route)
	if err != nil {
		return nil, fmt.Errorf("raft: marshal route: %w", err)
	}

	_, err = t.driver.apply(OpCreateRoute, putData{ID: id, Data: data})
	if err != nil {
		return nil, err
	}
	return t.GetRoute(t.ctx, id)
}

func (t *raftTx) GetRoute(_ context.Context, id string) (*riokuv1.Route, error) {
	var route riokuv1.Route
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketRoutes))
		raw := b.Get([]byte(id))
		if raw == nil {
			return fmt.Errorf("raft: route %q not found", id)
		}
		return protojson.Unmarshal(raw, &route)
	})
	if err != nil {
		return nil, err
	}
	return &route, nil
}

func (t *raftTx) ListRoutes(_ context.Context) ([]*riokuv1.Route, error) {
	var routes []*riokuv1.Route
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketRoutes))
		return b.ForEach(func(k, v []byte) error {
			var r riokuv1.Route
			if err := protojson.Unmarshal(v, &r); err != nil {
				return err
			}
			routes = append(routes, &r)
			return nil
		})
	})
	return routes, err
}

func (t *raftTx) UpdateRoute(_ context.Context, route *riokuv1.Route) (*riokuv1.Route, error) {
	now := nowUTC()
	route.UpdatedAt = timestamppb.New(now)

	data, err := protojson.Marshal(route)
	if err != nil {
		return nil, fmt.Errorf("raft: marshal route: %w", err)
	}

	_, err = t.driver.apply(OpUpdateRoute, putData{ID: route.GetId(), Data: data})
	if err != nil {
		return nil, err
	}
	return t.GetRoute(t.ctx, route.GetId())
}

func (t *raftTx) DeleteRoute(_ context.Context, id string) error {
	_, err := t.driver.apply(OpDeleteRoute, deleteData{ID: id})
	return err
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

func (t *raftTx) CreateService(_ context.Context, svc *riokuv1.Service) (*riokuv1.Service, error) {
	id := uuid.New().String()
	now := nowUTC()

	svc.Id = id
	svc.CreatedAt = timestamppb.New(now)
	svc.UpdatedAt = timestamppb.New(now)

	svcData, err := protojson.Marshal(svc)
	if err != nil {
		return nil, fmt.Errorf("raft: marshal service: %w", err)
	}

	var upstreams []upstreamEntry
	for _, u := range svc.GetUpstreams() {
		uid := u.GetId()
		if uid == "" {
			uid = uuid.New().String()
		}
		uData, err := marshalUpstreamWithServiceID(u, id, uid)
		if err != nil {
			return nil, err
		}
		upstreams = append(upstreams, upstreamEntry{ID: uid, Data: uData})
	}

	_, err = t.driver.apply(OpCreateService, serviceData{ID: id, Data: svcData, Upstreams: upstreams})
	if err != nil {
		return nil, err
	}
	return t.GetService(t.ctx, id)
}

func (t *raftTx) GetService(_ context.Context, id string) (*riokuv1.Service, error) {
	var svc riokuv1.Service
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketServices))
		raw := b.Get([]byte(id))
		if raw == nil {
			return fmt.Errorf("raft: service %q not found", id)
		}
		if err := protojson.Unmarshal(raw, &svc); err != nil {
			return err
		}

		// Fetch upstreams.
		ub := tx.Bucket([]byte(bucketUpstreams))
		svc.Upstreams = nil
		return ub.ForEach(func(k, v []byte) error {
			var entry struct {
				ServiceID string `json:"service_id"`
			}
			if err := json.Unmarshal(v, &entry); err != nil {
				return nil // skip malformed entries
			}
			if entry.ServiceID != id {
				return nil
			}
			var u riokuv1.Upstream
			if err := protojson.Unmarshal(v, &u); err != nil {
				return nil
			}
			svc.Upstreams = append(svc.Upstreams, &u)
			return nil
		})
	})
	if err != nil {
		return nil, err
	}
	return &svc, nil
}

func (t *raftTx) ListServices(_ context.Context) ([]*riokuv1.Service, error) {
	var services []*riokuv1.Service
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketServices))
		return b.ForEach(func(k, v []byte) error {
			var svc riokuv1.Service
			if err := protojson.Unmarshal(v, &svc); err != nil {
				return err
			}

			// Fetch upstreams for this service.
			ub := tx.Bucket([]byte(bucketUpstreams))
			_ = ub.ForEach(func(uk, uv []byte) error {
				var entry struct {
					ServiceID string `json:"service_id"`
				}
				if json.Unmarshal(uv, &entry) == nil && entry.ServiceID == string(k) {
					var u riokuv1.Upstream
					if protojson.Unmarshal(uv, &u) == nil {
						svc.Upstreams = append(svc.Upstreams, &u)
					}
				}
				return nil
			})

			services = append(services, &svc)
			return nil
		})
	})
	return services, err
}

func (t *raftTx) UpdateService(_ context.Context, svc *riokuv1.Service) (*riokuv1.Service, error) {
	now := nowUTC()
	svc.UpdatedAt = timestamppb.New(now)

	svcData, err := protojson.Marshal(svc)
	if err != nil {
		return nil, fmt.Errorf("raft: marshal service: %w", err)
	}

	var upstreams []upstreamEntry
	for _, u := range svc.GetUpstreams() {
		uid := u.GetId()
		if uid == "" {
			uid = uuid.New().String()
		}
		uData, err := marshalUpstreamWithServiceID(u, svc.GetId(), uid)
		if err != nil {
			return nil, err
		}
		upstreams = append(upstreams, upstreamEntry{ID: uid, Data: uData})
	}

	_, err = t.driver.apply(OpUpdateService, serviceData{ID: svc.GetId(), Data: svcData, Upstreams: upstreams})
	if err != nil {
		return nil, err
	}
	return t.GetService(t.ctx, svc.GetId())
}

func (t *raftTx) DeleteService(_ context.Context, id string) error {
	_, err := t.driver.apply(OpDeleteService, deleteData{ID: id})
	return err
}

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

func (t *raftTx) CreatePolicy(_ context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error) {
	id := uuid.New().String()
	now := nowUTC()

	pol.Id = id
	pol.CreatedAt = timestamppb.New(now)
	pol.UpdatedAt = timestamppb.New(now)

	data, err := protojson.Marshal(pol)
	if err != nil {
		return nil, fmt.Errorf("raft: marshal policy: %w", err)
	}

	_, err = t.driver.apply(OpCreatePolicy, putData{ID: id, Data: data})
	if err != nil {
		return nil, err
	}
	return t.GetPolicy(t.ctx, id)
}

func (t *raftTx) GetPolicy(_ context.Context, id string) (*riokuv1.Policy, error) {
	var pol riokuv1.Policy
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicies))
		raw := b.Get([]byte(id))
		if raw == nil {
			return fmt.Errorf("raft: policy %q not found", id)
		}
		return protojson.Unmarshal(raw, &pol)
	})
	if err != nil {
		return nil, err
	}
	return &pol, nil
}

func (t *raftTx) ListPolicies(_ context.Context) ([]*riokuv1.Policy, error) {
	var policies []*riokuv1.Policy
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicies))
		return b.ForEach(func(k, v []byte) error {
			var p riokuv1.Policy
			if err := protojson.Unmarshal(v, &p); err != nil {
				return err
			}
			policies = append(policies, &p)
			return nil
		})
	})
	return policies, err
}

func (t *raftTx) UpdatePolicy(_ context.Context, pol *riokuv1.Policy) (*riokuv1.Policy, error) {
	now := nowUTC()
	pol.UpdatedAt = timestamppb.New(now)

	data, err := protojson.Marshal(pol)
	if err != nil {
		return nil, fmt.Errorf("raft: marshal policy: %w", err)
	}

	_, err = t.driver.apply(OpUpdatePolicy, putData{ID: pol.GetId(), Data: data})
	if err != nil {
		return nil, err
	}
	return t.GetPolicy(t.ctx, pol.GetId())
}

func (t *raftTx) DeletePolicy(_ context.Context, id string) error {
	_, err := t.driver.apply(OpDeletePolicy, deleteData{ID: id})
	return err
}

// ---------------------------------------------------------------------------
// Policy Bindings
// ---------------------------------------------------------------------------

func (t *raftTx) AttachPolicy(_ context.Context, policyID, targetType, targetID string) error {
	_, err := t.driver.apply(OpAttachPolicy, policyBindingData{
		PolicyID:   policyID,
		TargetType: targetType,
		TargetID:   targetID,
	})
	return err
}

func (t *raftTx) DetachPolicy(_ context.Context, policyID, targetType, targetID string) error {
	_, err := t.driver.apply(OpDetachPolicy, policyBindingData{
		PolicyID:   policyID,
		TargetType: targetType,
		TargetID:   targetID,
	})
	return err
}

func (t *raftTx) ListPoliciesByTarget(_ context.Context, targetType, targetID string) ([]string, error) {
	var ids []string
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketPolicyBindings))
		return b.ForEach(func(k, v []byte) error {
			var pb policyBindingData
			if err := json.Unmarshal(v, &pb); err != nil {
				return nil // skip malformed
			}
			if pb.TargetType == targetType && pb.TargetID == targetID {
				ids = append(ids, pb.PolicyID)
			}
			return nil
		})
	})
	return ids, err
}

// ---------------------------------------------------------------------------
// API Keys
// ---------------------------------------------------------------------------

func (t *raftTx) CreateAPIKey(_ context.Context, name, keyHash string, scopes []string, expiresAt *time.Time, ownerID string) (string, error) {
	id := uuid.New().String()
	now := nowUTC()

	entry := map[string]interface{}{
		"id":         id,
		"name":       name,
		"key_hash":   keyHash,
		"scopes":     scopes,
		"created_at": now.Format(timeFormat),
	}
	if expiresAt != nil {
		entry["expires_at"] = expiresAt.UTC().Format(timeFormat)
	}
	if ownerID != "" {
		entry["owner_id"] = ownerID
	}

	data, err := json.Marshal(entry)
	if err != nil {
		return "", fmt.Errorf("raft: marshal api_key: %w", err)
	}

	_, err = t.driver.apply(OpCreateAPIKey, apiKeyData{ID: id, KeyHash: keyHash, Data: data})
	if err != nil {
		return "", err
	}
	return id, nil
}

func (t *raftTx) GetAPIKey(_ context.Context, id string) (*store.APIKey, error) {
	return t.readAPIKey(bucketAPIKeys, id)
}

func (t *raftTx) GetAPIKeyByHash(_ context.Context, keyHash string) (*store.APIKey, error) {
	// Look up ID from hash index.
	var id string
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		idx := tx.Bucket([]byte(bucketAPIKeysByHash))
		raw := idx.Get([]byte(keyHash))
		if raw == nil {
			return fmt.Errorf("raft: api_key with hash not found")
		}
		id = string(raw)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return t.readAPIKey(bucketAPIKeys, id)
}

func (t *raftTx) ListAPIKeys(_ context.Context) ([]*store.APIKey, error) {
	var keys []*store.APIKey
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketAPIKeys))
		return b.ForEach(func(k, v []byte) error {
			key, err := unmarshalAPIKey(v)
			if err != nil {
				return nil // skip malformed
			}
			if key.RevokedAt == nil { // match SQLite behavior: only non-revoked
				keys = append(keys, key)
			}
			return nil
		})
	})
	return keys, err
}

func (t *raftTx) RevokeAPIKey(_ context.Context, id string) error {
	now := nowUTC()
	_, err := t.driver.apply(OpRevokeAPIKey, revokeKeyData{
		ID:        id,
		RevokedAt: now.Format(timeFormat),
	})
	return err
}

func (t *raftTx) ListAPIKeysByOwner(_ context.Context, ownerID string) ([]*store.APIKey, error) {
	var keys []*store.APIKey
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketAPIKeys))
		return b.ForEach(func(k, v []byte) error {
			key, err := unmarshalAPIKey(v)
			if err != nil {
				return nil // skip malformed
			}
			if key.RevokedAt == nil && key.OwnerID == ownerID {
				keys = append(keys, key)
			}
			return nil
		})
	})
	return keys, err
}

func (t *raftTx) readAPIKey(bucket, id string) (*store.APIKey, error) {
	var key *store.APIKey
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucket))
		raw := b.Get([]byte(id))
		if raw == nil {
			return fmt.Errorf("raft: api_key %q not found", id)
		}
		var err error
		key, err = unmarshalAPIKey(raw)
		return err
	})
	return key, err
}

// ---------------------------------------------------------------------------
// Config Versions
// ---------------------------------------------------------------------------

func (t *raftTx) SaveConfigVersion(_ context.Context, snapshot []byte, actor string) (int64, error) {
	now := nowUTC()
	result, err := t.driver.apply(OpSaveConfigVersion, configVersionData{
		Snapshot: string(snapshot),
		Actor:    actor,
		Time:     now.Format(timeFormat),
	})
	if err != nil {
		return 0, err
	}
	var version int64
	if err := json.Unmarshal(result.Data, &version); err != nil {
		return 0, fmt.Errorf("raft: unmarshal version: %w", err)
	}
	return version, nil
}

func (t *raftTx) GetConfigVersion(_ context.Context, version int64) (*store.ConfigVersion, error) {
	var cv store.ConfigVersion
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketConfigVersions))
		key := make([]byte, 8)
		binary.BigEndian.PutUint64(key, uint64(version))
		raw := b.Get(key)
		if raw == nil {
			return fmt.Errorf("raft: config_version %d not found", version)
		}
		return unmarshalConfigVersion(raw, &cv)
	})
	if err != nil {
		return nil, err
	}
	return &cv, nil
}

func (t *raftTx) ListConfigVersions(_ context.Context, limit int) ([]*store.ConfigVersion, error) {
	var versions []*store.ConfigVersion
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketConfigVersions))
		c := b.Cursor()
		count := 0
		// Iterate in reverse (newest first) since keys are big-endian uint64.
		for k, v := c.Last(); k != nil && (limit <= 0 || count < limit); k, v = c.Prev() {
			var cv store.ConfigVersion
			if err := unmarshalConfigVersion(v, &cv); err != nil {
				continue
			}
			versions = append(versions, &cv)
			count++
		}
		return nil
	})
	return versions, err
}

func (t *raftTx) LatestConfigVersion(_ context.Context) (int64, error) {
	var version int64
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		meta := tx.Bucket([]byte(bucketMeta))
		raw := meta.Get([]byte(metaVersionCounter))
		if raw == nil {
			version = 0
			return nil
		}
		version = int64(binary.BigEndian.Uint64(raw))
		return nil
	})
	return version, err
}

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

func (t *raftTx) AppendAuditEntry(_ context.Context, entry *riokuv1.AuditEntry) error {
	id := entry.GetId()
	if id == "" {
		id = uuid.New().String()
	}

	data, err := protojson.Marshal(entry)
	if err != nil {
		return fmt.Errorf("raft: marshal audit entry: %w", err)
	}

	_, err = t.driver.apply(OpAppendAuditEntry, auditEntryData{ID: id, Data: data})
	return err
}

func (t *raftTx) QueryAuditLog(_ context.Context, query store.AuditQuery) ([]*riokuv1.AuditEntry, error) {
	var entries []*riokuv1.AuditEntry
	err := t.driver.readFSM(func(tx *bolt.Tx) error {
		b := tx.Bucket([]byte(bucketAuditLog))
		return b.ForEach(func(k, v []byte) error {
			var e riokuv1.AuditEntry
			if err := protojson.Unmarshal(v, &e); err != nil {
				return nil // skip malformed
			}

			// Apply filters.
			if query.Actor != "" && e.GetActor() != query.Actor {
				return nil
			}
			if query.EntityType != "" && e.GetEntityType() != query.EntityType {
				return nil
			}
			if query.EntityID != "" && e.GetEntityId() != query.EntityID {
				return nil
			}
			if query.Since != nil && e.GetOccurredAt().AsTime().Before(*query.Since) {
				return nil
			}
			if query.Until != nil && e.GetOccurredAt().AsTime().After(*query.Until) {
				return nil
			}

			entries = append(entries, &e)
			return nil
		})
	})
	if err != nil {
		return nil, err
	}

	// Apply offset and limit.
	if query.Offset > 0 && query.Offset < len(entries) {
		entries = entries[query.Offset:]
	} else if query.Offset >= len(entries) {
		entries = nil
	}
	if query.Limit > 0 && query.Limit < len(entries) {
		entries = entries[:query.Limit]
	}

	return entries, nil
}

// ---------------------------------------------------------------------------
// Users (stubs)
// ---------------------------------------------------------------------------

func (t *raftTx) CreateUser(_ context.Context, _ *store.User) (*store.User, error) {
	return nil, fmt.Errorf("raft: CreateUser not implemented")
}

func (t *raftTx) GetUser(_ context.Context, _ string) (*store.User, error) {
	return nil, fmt.Errorf("raft: GetUser not implemented")
}

func (t *raftTx) GetUserByUsername(_ context.Context, _ string) (*store.User, error) {
	return nil, fmt.Errorf("raft: GetUserByUsername not implemented")
}

func (t *raftTx) ListUsers(_ context.Context) ([]*store.User, error) {
	return nil, fmt.Errorf("raft: ListUsers not implemented")
}

func (t *raftTx) UpdateUser(_ context.Context, _ *store.User) (*store.User, error) {
	return nil, fmt.Errorf("raft: UpdateUser not implemented")
}

func (t *raftTx) DeleteUser(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteUser not implemented")
}

func (t *raftTx) IncrementFailedAttempts(_ context.Context, _ string, _ *time.Time) error {
	return fmt.Errorf("raft: IncrementFailedAttempts not implemented")
}

func (t *raftTx) ResetFailedAttempts(_ context.Context, _ string) error {
	return fmt.Errorf("raft: ResetFailedAttempts not implemented")
}

func (t *raftTx) UpdateLastLogin(_ context.Context, _ string) error {
	return fmt.Errorf("raft: UpdateLastLogin not implemented")
}

// ---------------------------------------------------------------------------
// Sessions (stubs)
// ---------------------------------------------------------------------------

func (t *raftTx) CreateSession(_ context.Context, _ *store.Session) (*store.Session, error) {
	return nil, fmt.Errorf("raft: CreateSession not implemented")
}

func (t *raftTx) GetSession(_ context.Context, _ string) (*store.Session, error) {
	return nil, fmt.Errorf("raft: GetSession not implemented")
}

func (t *raftTx) ListSessionsByUser(_ context.Context, _ string) ([]*store.Session, error) {
	return nil, fmt.Errorf("raft: ListSessionsByUser not implemented")
}

func (t *raftTx) DeleteSession(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteSession not implemented")
}

func (t *raftTx) DeleteSessionsByUser(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteSessionsByUser not implemented")
}

func (t *raftTx) DeleteSessionsByUserExcept(_ context.Context, _, _ string) error {
	return fmt.Errorf("raft: DeleteSessionsByUserExcept not implemented")
}

func (t *raftTx) UpdateSessionLastActive(_ context.Context, _ string, _ time.Time) error {
	return fmt.Errorf("raft: UpdateSessionLastActive not implemented")
}

func (t *raftTx) DeleteExpiredSessions(_ context.Context) (int64, error) {
	return 0, fmt.Errorf("raft: DeleteExpiredSessions not implemented")
}

// ---------------------------------------------------------------------------
// Roles (stubs)
// ---------------------------------------------------------------------------

func (t *raftTx) CreateRole(_ context.Context, _ store.CreateRoleParams) (*store.Role, error) {
	return nil, fmt.Errorf("raft: CreateRole not implemented")
}

func (t *raftTx) GetRole(_ context.Context, _ string) (*store.Role, error) {
	return nil, fmt.Errorf("raft: GetRole not implemented")
}

func (t *raftTx) ListRoles(_ context.Context) ([]*store.Role, error) {
	return nil, fmt.Errorf("raft: ListRoles not implemented")
}

func (t *raftTx) UpdateRole(_ context.Context, _ string, _ store.UpdateRoleParams) (*store.Role, error) {
	return nil, fmt.Errorf("raft: UpdateRole not implemented")
}

func (t *raftTx) DeleteRole(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteRole not implemented")
}

// ---------------------------------------------------------------------------
// Permissions (stubs)
// ---------------------------------------------------------------------------

func (t *raftTx) ListPermissions(_ context.Context) ([]*store.Permission, error) {
	return nil, fmt.Errorf("raft: ListPermissions not implemented")
}

func (t *raftTx) GetUserScopes(_ context.Context, _ string) ([]string, error) {
	return nil, fmt.Errorf("raft: GetUserScopes not implemented")
}

// ---------------------------------------------------------------------------
// User Roles (stubs)
// ---------------------------------------------------------------------------

func (t *raftTx) AssignRole(_ context.Context, _, _, _ string) error {
	return fmt.Errorf("raft: AssignRole not implemented")
}

func (t *raftTx) RevokeRole(_ context.Context, _, _ string) error {
	return fmt.Errorf("raft: RevokeRole not implemented")
}

func (t *raftTx) ListUserRoles(_ context.Context, _ string) ([]*store.UserRole, error) {
	return nil, fmt.Errorf("raft: ListUserRoles not implemented")
}

func (t *raftTx) ListUsersWithRole(_ context.Context, _ string) ([]string, error) {
	return nil, fmt.Errorf("raft: ListUsersWithRole not implemented")
}

// ---------------------------------------------------------------------------
// TOTP Backup Codes (stubs)
// ---------------------------------------------------------------------------

func (t *raftTx) CreateTOTPBackupCodes(_ context.Context, _ string, _ []string) error {
	return fmt.Errorf("raft: CreateTOTPBackupCodes not implemented")
}

func (t *raftTx) ListUnusedTOTPBackupCodes(_ context.Context, _ string) ([]*store.TOTPBackupCode, error) {
	return nil, fmt.Errorf("raft: ListUnusedTOTPBackupCodes not implemented")
}

func (t *raftTx) MarkTOTPBackupCodeUsed(_ context.Context, _ string) error {
	return fmt.Errorf("raft: MarkTOTPBackupCodeUsed not implemented")
}

func (t *raftTx) DeleteTOTPBackupCodes(_ context.Context, _ string) error {
	return fmt.Errorf("raft: DeleteTOTPBackupCodes not implemented")
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func nowUTC() time.Time {
	return time.Now().UTC()
}

func marshalUpstreamWithServiceID(u *riokuv1.Upstream, serviceID, upstreamID string) (json.RawMessage, error) {
	// Store as a combined JSON that includes service_id for lookup.
	entry := map[string]interface{}{
		"service_id": serviceID,
		"id":         upstreamID,
		"address":    u.GetAddress(),
		"weight":     u.GetWeight(),
		"tls":        int32(u.GetTls()),
		"healthy":    u.GetHealthy(),
		"dial_err":   u.GetDialErr(),
	}
	return json.Marshal(entry)
}

func unmarshalAPIKey(data []byte) (*store.APIKey, error) {
	var entry map[string]interface{}
	if err := json.Unmarshal(data, &entry); err != nil {
		return nil, err
	}

	key := &store.APIKey{
		ID:      getString(entry, "id"),
		Name:    getString(entry, "name"),
		KeyHash: getString(entry, "key_hash"),
	}

	if scopesRaw, ok := entry["scopes"]; ok {
		if arr, ok := scopesRaw.([]interface{}); ok {
			for _, s := range arr {
				if str, ok := s.(string); ok {
					key.Scopes = append(key.Scopes, str)
				}
			}
		}
	}

	if s := getString(entry, "created_at"); s != "" {
		t, _ := time.Parse(timeFormat, s)
		key.CreatedAt = t
	}
	if s := getString(entry, "expires_at"); s != "" {
		t, _ := time.Parse(timeFormat, s)
		key.ExpiresAt = &t
	}
	if s := getString(entry, "revoked_at"); s != "" {
		t, _ := time.Parse(timeFormat, s)
		key.RevokedAt = &t
	}
	key.OwnerID = getString(entry, "owner_id")

	return key, nil
}

func unmarshalConfigVersion(data []byte, cv *store.ConfigVersion) error {
	var entry map[string]interface{}
	if err := json.Unmarshal(data, &entry); err != nil {
		return err
	}
	if v, ok := entry["version"].(float64); ok {
		cv.Version = int64(v)
	}
	cv.Snapshot = []byte(getString(entry, "snapshot"))
	cv.Actor = getString(entry, "actor")
	if s := getString(entry, "created_at"); s != "" {
		cv.CreatedAt, _ = time.Parse(timeFormat, s)
	}
	return nil
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
