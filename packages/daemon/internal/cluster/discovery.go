// Package cluster provides gossip-based cluster discovery using hashicorp/memberlist.
// It complements the raft store driver by handling node discovery, health checking,
// and automatic raft voter management.
package cluster

import (
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/hashicorp/memberlist"
)

// NodeMeta is the metadata each node gossips to the cluster.
type NodeMeta struct {
	NodeID   string `json:"node_id"`
	RaftAddr string `json:"raft_addr"`
	RPCPort  int    `json:"rpc_port"`
	Role     string `json:"role"`    // "voter", "nonvoter", "staging"
	Version  string `json:"version"` // rioku version
}

// VoterManager is the interface the discovery system uses to add/remove
// raft voters. The raft Driver implements this.
type VoterManager interface {
	AddVoter(id, addr string) error
	RemoveServer(id string) error
	IsLeader() bool
}

// DiscoveryConfig configures the discovery system.
type DiscoveryConfig struct {
	// NodeMeta is this node's metadata to gossip.
	NodeMeta NodeMeta
	// BindAddr is the memberlist bind address (e.g. "0.0.0.0:7946").
	BindAddr string
	// BindPort is the memberlist bind port.
	BindPort int
	// AdvertiseAddr is the address other nodes use to reach this node.
	AdvertiseAddr string
	// AdvertisePort is the advertised port.
	AdvertisePort int
	// SeedAddrs are addresses of existing cluster members to join.
	SeedAddrs []string
	// VoterManager manages raft voter registration (optional, nil if raft isn't used).
	VoterManager VoterManager
	// FailureGracePeriod is how long to wait after a node failure before removing
	// it from the raft voter set. Prevents flapping.
	FailureGracePeriod time.Duration
}

// Discovery manages gossip-based cluster discovery.
type Discovery struct {
	mu     sync.RWMutex
	ml     *memberlist.Memberlist
	config DiscoveryConfig

	// nodes tracks discovered nodes by their NodeID.
	nodes map[string]NodeMeta

	// failTimers tracks pending voter removal timers for failed nodes.
	failTimers map[string]*time.Timer

	// delegate handles memberlist callbacks.
	delegate *delegate

	stopCh chan struct{}
}

// New creates a new Discovery instance but does not start it.
func New(cfg DiscoveryConfig) *Discovery {
	if cfg.FailureGracePeriod == 0 {
		cfg.FailureGracePeriod = 10 * time.Second
	}

	d := &Discovery{
		config:     cfg,
		nodes:      make(map[string]NodeMeta),
		failTimers: make(map[string]*time.Timer),
		stopCh:     make(chan struct{}),
	}
	d.delegate = &delegate{discovery: d}
	return d
}

// Start initializes memberlist and joins the cluster if seed addresses are provided.
func (d *Discovery) Start() error {
	mlConfig := memberlist.DefaultLANConfig()
	mlConfig.Name = d.config.NodeMeta.NodeID
	mlConfig.BindAddr = d.config.BindAddr
	mlConfig.BindPort = d.config.BindPort
	// Faster failure detection for small clusters.
	mlConfig.ProbeInterval = 500 * time.Millisecond
	mlConfig.SuspicionMult = 2
	mlConfig.GossipInterval = 200 * time.Millisecond
	if d.config.AdvertiseAddr != "" {
		mlConfig.AdvertiseAddr = d.config.AdvertiseAddr
	}
	if d.config.AdvertisePort > 0 {
		mlConfig.AdvertisePort = d.config.AdvertisePort
	}
	mlConfig.Delegate = d.delegate
	mlConfig.Events = d.delegate
	mlConfig.LogOutput = log.Default().Writer()

	ml, err := memberlist.Create(mlConfig)
	if err != nil {
		return fmt.Errorf("discovery: create memberlist: %w", err)
	}
	d.ml = ml

	// Register ourselves.
	d.mu.Lock()
	d.nodes[d.config.NodeMeta.NodeID] = d.config.NodeMeta
	d.mu.Unlock()

	// Join seed nodes if provided.
	if len(d.config.SeedAddrs) > 0 {
		n, err := ml.Join(d.config.SeedAddrs)
		if err != nil {
			ml.Shutdown()
			return fmt.Errorf("discovery: join cluster: %w", err)
		}
		log.Printf("discovery: joined %d existing nodes", n)
	}

	return nil
}

// Stop shuts down the memberlist and cancels pending timers.
func (d *Discovery) Stop() error {
	close(d.stopCh)

	d.mu.Lock()
	for _, t := range d.failTimers {
		t.Stop()
	}
	d.failTimers = nil
	d.mu.Unlock()

	if d.ml != nil {
		return d.ml.Shutdown()
	}
	return nil
}

// Members returns the current set of known nodes.
func (d *Discovery) Members() []NodeMeta {
	d.mu.RLock()
	defer d.mu.RUnlock()
	members := make([]NodeMeta, 0, len(d.nodes))
	for _, m := range d.nodes {
		members = append(members, m)
	}
	return members
}

// NumMembers returns the number of known nodes.
func (d *Discovery) NumMembers() int {
	d.mu.RLock()
	defer d.mu.RUnlock()
	return len(d.nodes)
}

// MemberlistStats returns memberlist health stats for diagnostics.
func (d *Discovery) MemberlistStats() map[string]string {
	if d.ml == nil {
		return nil
	}
	health := d.ml.GetHealthScore()
	members := d.ml.Members()
	return map[string]string{
		"health_score": fmt.Sprintf("%d", health),
		"member_count": fmt.Sprintf("%d", len(members)),
		"protocol_min": fmt.Sprintf("%d", d.ml.ProtocolVersion()),
	}
}

// handleNodeJoin processes a newly discovered node.
func (d *Discovery) handleNodeJoin(meta NodeMeta) {
	d.mu.Lock()
	defer d.mu.Unlock()

	// Cancel any pending removal timer for this node (it's back).
	if t, ok := d.failTimers[meta.NodeID]; ok {
		t.Stop()
		delete(d.failTimers, meta.NodeID)
		log.Printf("discovery: node %s rejoined, canceling removal timer", meta.NodeID)
	}

	d.nodes[meta.NodeID] = meta

	// If we're the raft leader, add this node as a voter.
	if d.config.VoterManager != nil && d.config.VoterManager.IsLeader() {
		if meta.NodeID != d.config.NodeMeta.NodeID {
			go func() {
				if err := d.config.VoterManager.AddVoter(meta.NodeID, meta.RaftAddr); err != nil {
					log.Printf("discovery: failed to add voter %s: %v", meta.NodeID, err)
				} else {
					log.Printf("discovery: added voter %s at %s", meta.NodeID, meta.RaftAddr)
				}
			}()
		}
	}
}

// handleNodeLeave processes a node that has left the cluster.
func (d *Discovery) handleNodeLeave(nodeID string) {
	d.mu.Lock()
	defer d.mu.Unlock()

	delete(d.nodes, nodeID)

	// Don't remove self.
	if nodeID == d.config.NodeMeta.NodeID {
		return
	}

	// Start a grace period timer before removing from raft.
	if d.config.VoterManager != nil && d.config.VoterManager.IsLeader() {
		if _, pending := d.failTimers[nodeID]; !pending {
			d.failTimers[nodeID] = time.AfterFunc(d.config.FailureGracePeriod, func() {
				d.mu.Lock()
				delete(d.failTimers, nodeID)
				d.mu.Unlock()

				if d.config.VoterManager != nil && d.config.VoterManager.IsLeader() {
					if err := d.config.VoterManager.RemoveServer(nodeID); err != nil {
						log.Printf("discovery: failed to remove server %s: %v", nodeID, err)
					} else {
						log.Printf("discovery: removed server %s after grace period", nodeID)
					}
				}
			})
			log.Printf("discovery: node %s failed, will remove in %v", nodeID, d.config.FailureGracePeriod)
		}
	}
}

// ---------------------------------------------------------------------------
// memberlist.Delegate + memberlist.EventDelegate implementation
// ---------------------------------------------------------------------------

type delegate struct {
	discovery *Discovery
}

// NodeMeta returns the encoded metadata for this node.
func (d *delegate) NodeMeta(limit int) []byte {
	data, err := json.Marshal(d.discovery.config.NodeMeta)
	if err != nil {
		return nil
	}
	if len(data) > limit {
		return nil
	}
	return data
}

// NotifyMsg handles incoming user messages (not used for discovery).
func (d *delegate) NotifyMsg([]byte) {}

// GetBroadcasts returns queued broadcasts (used by CRDT layer, not discovery).
func (d *delegate) GetBroadcasts(overhead, limit int) [][]byte { return nil }

// LocalState returns the full local state for push/pull sync.
func (d *delegate) LocalState(join bool) []byte {
	d.discovery.mu.RLock()
	defer d.discovery.mu.RUnlock()
	data, _ := json.Marshal(d.discovery.nodes)
	return data
}

// MergeRemoteState merges the remote node's state during push/pull sync.
func (d *delegate) MergeRemoteState(buf []byte, join bool) {
	var remote map[string]NodeMeta
	if err := json.Unmarshal(buf, &remote); err != nil {
		return
	}
	d.discovery.mu.Lock()
	defer d.discovery.mu.Unlock()
	for id, meta := range remote {
		d.discovery.nodes[id] = meta
	}
}

// --- EventDelegate ---

// NotifyJoin is called when a node joins the cluster.
func (d *delegate) NotifyJoin(node *memberlist.Node) {
	var meta NodeMeta
	if err := json.Unmarshal(node.Meta, &meta); err != nil {
		// Fallback: use the memberlist node name as the ID.
		meta.NodeID = node.Name
		meta.RaftAddr = fmt.Sprintf("%s:%d", node.Addr, node.Port)
	}
	d.discovery.handleNodeJoin(meta)
}

// NotifyLeave is called when a node leaves or is detected as failed.
func (d *delegate) NotifyLeave(node *memberlist.Node) {
	d.discovery.handleNodeLeave(node.Name)
}

// NotifyUpdate is called when a node's metadata changes.
func (d *delegate) NotifyUpdate(node *memberlist.Node) {
	var meta NodeMeta
	if err := json.Unmarshal(node.Meta, &meta); err != nil {
		return
	}
	d.discovery.mu.Lock()
	d.discovery.nodes[meta.NodeID] = meta
	d.discovery.mu.Unlock()
}
