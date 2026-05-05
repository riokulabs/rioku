// Owned by Plan 10 (cluster) — types for the cluster resource surface.

import type { ID } from './common';

/**
 * A single node participating in the Rioku cluster.
 * Stage-1 mock — real data flows from daemon gRPC ClusterService at stage 2.
 */
export interface ClusterNode {
  readonly id: ID;
  name: string; // e.g. "rioku-east-1"
  role: 'primary' | 'replica' | 'witness';
  status: 'healthy' | 'degraded' | 'unreachable' | 'joining' | 'leaving';
  address: string; // e.g. "10.0.1.23:7777"
  version: string; // e.g. "0.1.0"
  joined_at: string;
  last_heartbeat_at: string;
  metrics: {
    cpu_percent: number; // 0-100
    memory_percent: number; // 0-100
    requests_per_second: number;
    latency_p95_ms: number;
  };
}

/**
 * A short-lived enrollment token used to join a new node to the cluster.
 * Stage-1 mock — real token issuance happens at stage 2.
 */
export interface ClusterEnrollmentToken {
  readonly id: ID;
  token: string; // fake bearer token
  created_by: ID; // user_id
  expires_at: string;
  consumed_by_node_id?: ID; // set once a node consumes the token
  readonly created_at: string;
}
