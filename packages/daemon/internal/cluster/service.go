// Package cluster — high-level Service surface used by the gateway.
//
// The existing Discovery type owns the gossip / memberlist mechanics. This
// file adds a thin abstraction the REST layer can target without depending
// on Discovery directly — useful because:
//
//   - Single-node deployments don't construct a Discovery at all but still
//     need /api/v1/cluster/nodes to return *something*.
//   - Discovery.Members() returns NodeMeta but the admin panel wants
//     node-level health + version + last-seen + role rolled into one
//     payload.
//   - Stage-2 will add metric collection (#122 health polling) and the
//     gateway shouldn't have to learn that pipeline.
//
// LocalOnlyService is the default implementation: it reports the running
// daemon as the sole node and rejects multi-node operations. Once #57 +
// real Discovery wiring lands, the daemon swaps in DiscoveryBackedService.
package cluster

import (
	"context"
	"fmt"
	"os"
	"sync"
	"time"
)

// NodeRole describes a node's role in the cluster.
type NodeRole string

const (
	// RoleBootstrap — a single-node deployment or the founding node of a cluster.
	RoleBootstrap NodeRole = "bootstrap"
	// RoleVoter — a full raft voter, has a vote in elections.
	RoleVoter NodeRole = "voter"
	// RoleNonvoter — replicates state but does not vote.
	RoleNonvoter NodeRole = "nonvoter"
)

// NodeHealth is the high-level health bucket the admin panel renders.
type NodeHealth string

const (
	// HealthHealthy — node is reachable and operating normally.
	HealthHealthy NodeHealth = "healthy"
	// HealthDegraded — node is reachable but reporting issues (high CPU, behind on raft, etc.).
	HealthDegraded NodeHealth = "degraded"
	// HealthUnreachable — gossip lost the node.
	HealthUnreachable NodeHealth = "unreachable"
)

// NodeInfo is the rolled-up per-node payload returned to the admin.
type NodeInfo struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Role          NodeRole          `json:"role"`
	Health        NodeHealth        `json:"health"`
	DaemonVersion string            `json:"daemonVersion"`
	GoVersion     string            `json:"goVersion,omitempty"`
	StoreMode     string            `json:"storeMode"`
	RaftAddr      string            `json:"raftAddr,omitempty"`
	IsSelf        bool              `json:"isSelf"`
	IsLeader      bool              `json:"isLeader"`
	LastSeen      time.Time         `json:"lastSeen"`
	Metrics       map[string]string `json:"metrics,omitempty"`
}

// SyncResult is returned from ForceSync.
type SyncResult struct {
	// StartedAt is when the sync was triggered.
	StartedAt time.Time `json:"startedAt"`
	// Duration is how long the sync took (server-side wall clock).
	Duration time.Duration `json:"duration"`
	// PushedToCaddy is true when the daemon successfully recompiled +
	// reloaded the local Caddy admin config.
	PushedToCaddy bool `json:"pushedToCaddy"`
	// NodesNotified is the number of remote nodes the local node attempted
	// to nudge (best-effort). Always 0 for single-node.
	NodesNotified int `json:"nodesNotified"`
	// Note is a free-text explanation surfaced to the operator (e.g.
	// "single-node deployment — sync is a local Caddy reload only").
	Note string `json:"note,omitempty"`
}

// Service is the gateway-facing API for cluster operations.
type Service interface {
	// ListNodes returns the current cluster membership snapshot. Empty
	// slice (never nil) when no nodes are known.
	ListNodes(ctx context.Context) ([]NodeInfo, error)
	// RemoveNode removes the given node ID from the cluster (gossip + raft
	// voter set). Returns an error for unknown ids, the local node, or
	// when the caller isn't currently the raft leader.
	RemoveNode(ctx context.Context, id string) error
	// ForceSync triggers an out-of-band sync round: locally recompile and
	// push to Caddy, then nudge known peers. Returns server-side timing.
	ForceSync(ctx context.Context) (SyncResult, error)
}

// ─── LocalOnlyService ───────────────────────────────────────────────────────

// LocalOnlyConfig configures the LocalOnlyService.
type LocalOnlyConfig struct {
	NodeID        string
	NodeName      string
	DaemonVersion string
	GoVersion     string
	StoreMode     string
	// CaddyReload — optional. When non-nil, ForceSync calls this hook so
	// the daemon's caddy.Manager can recompile + push the admin config.
	CaddyReload func(ctx context.Context) error
}

// LocalOnlyService is the default Service implementation for deployments
// that aren't running a real cluster (single-node SQLite, single-node
// raft without joined peers, etc.). All it knows is the running daemon.
type LocalOnlyService struct {
	mu        sync.RWMutex
	cfg       LocalOnlyConfig
	startedAt time.Time
}

// NewLocalOnlyService constructs a LocalOnlyService. NodeName defaults to
// the OS hostname if not provided. NodeID defaults to NodeName.
func NewLocalOnlyService(cfg LocalOnlyConfig) *LocalOnlyService {
	if cfg.NodeName == "" {
		hostname, _ := os.Hostname()
		if hostname == "" {
			hostname = "node-0"
		}
		cfg.NodeName = hostname
	}
	if cfg.NodeID == "" {
		cfg.NodeID = cfg.NodeName
	}
	return &LocalOnlyService{cfg: cfg, startedAt: time.Now().UTC()}
}

// ListNodes returns a single-element slice describing the running daemon.
func (s *LocalOnlyService) ListNodes(_ context.Context) ([]NodeInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return []NodeInfo{{
		ID:            s.cfg.NodeID,
		Name:          s.cfg.NodeName,
		Role:          RoleBootstrap,
		Health:        HealthHealthy,
		DaemonVersion: s.cfg.DaemonVersion,
		GoVersion:     s.cfg.GoVersion,
		StoreMode:     s.cfg.StoreMode,
		IsSelf:        true,
		IsLeader:      true,
		LastSeen:      time.Now().UTC(),
		Metrics: map[string]string{
			"uptime_seconds": fmt.Sprintf("%d", int(time.Since(s.startedAt).Seconds())),
		},
	}}, nil
}

// RemoveNode always errors — there's only one node.
func (s *LocalOnlyService) RemoveNode(_ context.Context, id string) error {
	return fmt.Errorf("cluster: cannot remove node %q from a single-node deployment", id)
}

// ForceSync recompiles + pushes Caddy if a reload hook was configured.
// Returns a SyncResult with PushedToCaddy=true on success.
func (s *LocalOnlyService) ForceSync(ctx context.Context) (SyncResult, error) {
	start := time.Now().UTC()
	s.mu.RLock()
	hook := s.cfg.CaddyReload
	s.mu.RUnlock()

	if hook == nil {
		return SyncResult{
			StartedAt: start,
			Duration:  time.Since(start),
			Note:      "single-node deployment with no Caddy hook configured — nothing to sync",
		}, nil
	}
	if err := hook(ctx); err != nil {
		return SyncResult{
			StartedAt: start,
			Duration:  time.Since(start),
		}, fmt.Errorf("cluster: caddy reload: %w", err)
	}
	return SyncResult{
		StartedAt:     start,
		Duration:      time.Since(start),
		PushedToCaddy: true,
		Note:          "single-node deployment — sync is a local Caddy reload only",
	}, nil
}
