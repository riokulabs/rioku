---
title: Cluster Sync
description: Node membership, gossip discovery, raft replication, and CRDT state propagation
sidebar_position: 3
---

Rioku supports both single-node and multi-node deployments. Single-node uses SQLite and a no-op cluster service. Multi-node uses raft for config replication and memberlist (hashicorp/memberlist) for node discovery and health checking.

```mermaid
flowchart TD
    subgraph node_a["Node A (leader)"]
        DA["rioku daemon"]
        RA["raft store"]
        MA["memberlist"]
        CA["caddy child"]
        CRDT_A["CRDT counters"]
    end

    subgraph node_b["Node B (voter)"]
        DB["rioku daemon"]
        RB["raft store"]
        MB["memberlist"]
        CB["caddy child"]
        CRDT_B["CRDT counters"]
    end

    subgraph node_c["Node C (voter)"]
        DC["rioku daemon"]
        RC["raft store"]
        MC["memberlist"]
        CC["caddy child"]
        CRDT_C["CRDT counters"]
    end

    %% Raft log replication
    RA -- "raft log replication" --> RB
    RA -- "raft log replication" --> RC

    %% Gossip mesh
    MA <-- "gossip (UDP)" --> MB
    MB <-- "gossip (UDP)" --> MC
    MA <-- "gossip (UDP)" --> MC

    %% CRDT merge via gossip
    CRDT_A -- "PNCounter merge via gossip" --> CRDT_B
    CRDT_A -- "PNCounter merge via gossip" --> CRDT_C

    %% Config compile + push to Caddy
    RA -- "compile + PushConfig" --> CA
    RB -- "compile + PushConfig" --> CB
    RC -- "compile + PushConfig" --> CC

    %% Voter management: gossip drives raft
    MA -- "AddVoter / RemoveServer" --> RA

    %% Client writes to leader
    Client["REST client"] -- "write (any node)" --> DA
    DA -- "forward to leader if not leader" --> DA
```

**How config changes propagate:**

1. A write hits any node's REST API.
2. If the node is not the raft leader, the request is forwarded to the leader.
3. The leader appends the change to the raft log and replicates it to a quorum.
4. Once committed, each node's `internal/sync` agent detects the change, recompiles the Caddy config, and pushes it to that node's Caddy child via the admin API.

**Single-node deployments** use `LocalOnlyService` (`internal/cluster/service.go`), which reports only the running daemon and routes `ForceSync` directly to a local Caddy reload. No raft or gossip is involved.

**CRDT usage:** `internal/cluster/crdt/counter.go` implements a `PNCounter`, a conflict-free replicated counter where each node increments its own partition locally (zero coordination latency) and counter state converges via periodic gossip merges. The primary use case is distributed rate-limit counters.

**Node roles:**

- `bootstrap`: founding node of a single-node or new cluster
- `voter`: full raft participant with a vote in leader elections
- `nonvoter`: replicates state but does not vote (read replicas, observer nodes)

**Source files:**

- `packages/daemon/internal/cluster/discovery.go`: memberlist-based gossip, `VoterManager` interface
- `packages/daemon/internal/cluster/service.go`: `Service` interface + `LocalOnlyService` (single-node default)
- `packages/daemon/internal/cluster/crdt/counter.go`: `PNCounter` CRDT
- `packages/daemon/internal/store/raft/`: raft store driver
- `packages/daemon/internal/sync/`: config recompile + Caddy push agent
