# Rioku — gRPC Proto Definitions
**Version:** 0.2
**Status:** Implemented
**Last Updated:** 2026-04-09

---

## Build Configuration

### buf.yaml
```yaml
version: v2

modules:
  - path: .

deps:
  - buf.build/googleapis/googleapis
  - buf.build/protocolbuffers/wellknowntypes

lint:
  use:
    - STANDARD
  except:
    - PACKAGE_VERSION_SUFFIX
    - RPC_REQUEST_STANDARD_NAME
    - RPC_RESPONSE_STANDARD_NAME
    - RPC_REQUEST_RESPONSE_UNIQUE
    - ENUM_VALUE_PREFIX

breaking:
  use:
    - FILE
```

### buf.gen.yaml
```yaml
version: v2

plugins:
  - remote: buf.build/protocolbuffers/go
    out: gen/go
    opt:
      - paths=source_relative

  - remote: buf.build/grpc/go
    out: gen/go
    opt:
      - paths=source_relative
      - require_unimplemented_servers=true

  - remote: buf.build/grpc-ecosystem/gateway
    out: gen/go
    opt:
      - paths=source_relative
      - generate_unbound_methods=false

  - remote: buf.build/grpc-ecosystem/openapiv2
    out: gen/openapi
```

---

## proto/common.proto

```protobuf
syntax = "proto3";

package rioku.v1;

option go_package = "github.com/riokulabs/rioku/proto/gen/go/rioku/v1;riokuv1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/any.proto";

message PageRequest {
  int32  page_size  = 1;
  string page_token = 2;
}

message PageResponse {
  string next_page_token = 1;
  int64  total           = 2;  // -1 if unknown
}

message Labels {
  map<string, string> labels = 1;
}

message MutationMeta {
  int64                     config_version = 1;
  string                    actor          = 2;
  google.protobuf.Timestamp mutated_at     = 3;
}

enum HealthState {
  HEALTH_STATE_UNSPECIFIED = 0;
  HEALTH_STATE_OK          = 1;
  HEALTH_STATE_DEGRADED    = 2;
  HEALTH_STATE_UNHEALTHY   = 3;
}

enum TLSMode {
  TLS_MODE_UNSPECIFIED = 0;
  TLS_MODE_OFF         = 1;
  TLS_MODE_AUTO        = 2;
  TLS_MODE_CUSTOM      = 3;
  TLS_MODE_INTERNAL    = 4;
}
```

---

## proto/config.proto

```protobuf
syntax = "proto3";

package rioku.v1;

option go_package = "github.com/riokulabs/rioku/proto/gen/go/rioku/v1;riokuv1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/struct.proto";
import "google/api/annotations.proto";
import "rioku/v1/common.proto";

message Route {
  string                    id          = 1;
  string                    name        = 2;
  repeated Matcher          matchers    = 3;
  oneof target {
    string                  service_id  = 4;
    DirectUpstream          upstream    = 5;
  }
  repeated string           policy_ids  = 6;
  bool                      enabled     = 7;
  Labels                    labels      = 8;
  google.protobuf.Timestamp created_at  = 9;
  google.protobuf.Timestamp updated_at  = 10;
}

message Matcher {
  repeated string        hosts    = 1;
  repeated PathMatcher   paths    = 2;
  repeated string        methods  = 3;
  repeated HeaderMatcher headers  = 4;
}

message PathMatcher {
  enum Type {
    TYPE_UNSPECIFIED = 0;
    TYPE_EXACT       = 1;
    TYPE_PREFIX      = 2;
    TYPE_REGEXP      = 3;
  }
  Type   type  = 1;
  string value = 2;
}

message HeaderMatcher {
  string name   = 1;
  string value  = 2;
  bool   invert = 3;
}

message DirectUpstream {
  string  address = 1;
  TLSMode tls     = 2;
}

message Service {
  string                    id           = 1;
  string                    name         = 2;
  repeated Upstream         upstreams    = 3;
  LoadBalancingPolicy       lb_policy    = 4;
  HealthCheck               health_check = 5;
  Labels                    labels       = 6;
  google.protobuf.Timestamp created_at   = 7;
  google.protobuf.Timestamp updated_at   = 8;
}

message Upstream {
  string  id       = 1;
  string  address  = 2;
  int32   weight   = 3;
  TLSMode tls      = 4;
  bool    healthy  = 5;
  string  dial_err = 6;
}

enum LoadBalancingPolicy {
  LB_POLICY_UNSPECIFIED          = 0;
  LB_POLICY_ROUND_ROBIN          = 1;
  LB_POLICY_RANDOM               = 2;
  LB_POLICY_LEAST_CONN           = 3;
  LB_POLICY_IP_HASH              = 4;
  LB_POLICY_WEIGHTED_ROUND_ROBIN = 5;
}

message HealthCheck {
  bool          enabled             = 1;
  string        path                = 2;
  int32         interval_seconds    = 3;
  int32         timeout_seconds     = 4;
  int32         unhealthy_threshold = 5;
  int32         healthy_threshold   = 6;
  repeated int32 expected_statuses  = 7;
}

message Policy {
  string                    id         = 1;
  string                    name       = 2;
  PolicyType                type       = 3;
  google.protobuf.Struct    config     = 4;
  Labels                    labels     = 5;
  google.protobuf.Timestamp created_at = 6;
  google.protobuf.Timestamp updated_at = 7;
}

enum PolicyType {
  POLICY_TYPE_UNSPECIFIED  = 0;
  POLICY_TYPE_RATE_LIMIT   = 1;
  POLICY_TYPE_AUTH_API_KEY = 2;
  POLICY_TYPE_AUTH_JWT     = 3;
  POLICY_TYPE_TRANSFORM   = 4;
  POLICY_TYPE_ALLOW_LIST  = 5;
  POLICY_TYPE_BLOCK_LIST  = 6;
}

message ConfigSnapshot {
  int64                     version     = 1;
  repeated Route            routes      = 2;
  repeated Service          services    = 3;
  repeated Policy           policies    = 4;
  google.protobuf.Timestamp snapshot_at = 5;
}

message GetConfigRequest  { int64 version = 1; }

message ConfigChange {
  oneof operation {
    RouteOp   route   = 1;
    ServiceOp service = 2;
    PolicyOp  policy  = 3;
  }
  int64 expected_version = 10;
}

message RouteOp {
  enum Action { ACTION_UNSPECIFIED = 0; UPSERT = 1; DELETE = 2; }
  Action action = 1;
  Route  route  = 2;
  string id     = 3;
}

message ServiceOp {
  enum Action { ACTION_UNSPECIFIED = 0; UPSERT = 1; DELETE = 2; }
  Action  action  = 1;
  Service service = 2;
  string  id      = 3;
}

message PolicyOp {
  enum Action { ACTION_UNSPECIFIED = 0; UPSERT = 1; DELETE = 2; }
  Action action = 1;
  Policy policy = 2;
  string id     = 3;
}

message ApplyResult {
  MutationMeta    meta     = 1;
  repeated string warnings = 2;
}

message WatchRequest  { int64 since_version = 1; }

message ConfigEvent {
  enum Type {
    TYPE_UNSPECIFIED       = 0;
    TYPE_ROUTE_UPSERTED   = 1;
    TYPE_ROUTE_DELETED    = 2;
    TYPE_SERVICE_UPSERTED = 3;
    TYPE_SERVICE_DELETED  = 4;
    TYPE_POLICY_UPSERTED  = 5;
    TYPE_POLICY_DELETED   = 6;
    TYPE_SNAPSHOT         = 7;
  }
  Type                      type        = 1;
  int64                     version     = 2;
  string                    actor       = 3;
  google.protobuf.Timestamp occurred_at = 4;
  ConfigSnapshot            snapshot    = 5;
  oneof entity {
    Route   route   = 6;
    Service service = 7;
    Policy  policy  = 8;
  }
}

message AuditQuery {
  string                    actor       = 1;
  string                    entity_type = 2;
  string                    entity_id   = 3;
  google.protobuf.Timestamp since       = 4;
  google.protobuf.Timestamp until       = 5;
  PageRequest               page        = 6;
}

message AuditEntry {
  string                    id             = 1;
  string                    actor          = 2;
  string                    entity_type    = 3;
  string                    entity_id      = 4;
  string                    operation      = 5;
  string                    diff           = 6;
  int64                     config_version = 7;
  google.protobuf.Timestamp occurred_at    = 8;
}

message ExportRequest { int64 version = 1; bool include_audit_log = 2; }
message ConfigChunk   { int32 sequence = 1; bool last = 2; bytes data = 3; }
message ImportResult  {
  MutationMeta    meta               = 1;
  int32           routes_imported    = 2;
  int32           services_imported  = 3;
  int32           policies_imported  = 4;
  repeated string warnings           = 5;
}

service ConfigService {
  rpc GetConfig(GetConfigRequest) returns (ConfigSnapshot) {
    option (google.api.http) = { get: "/api/v1/config" };
  }
  rpc ApplyChange(ConfigChange) returns (ApplyResult) {
    option (google.api.http) = { post: "/api/v1/config" body: "*" };
  }
  // SSE at REST: GET /api/v1/events/config
  rpc WatchChanges(WatchRequest) returns (stream ConfigEvent);
  rpc GetAuditLog(AuditQuery) returns (stream AuditEntry) {
    option (google.api.http) = { get: "/api/v1/audit" };
  }
  rpc ExportConfig(ExportRequest) returns (stream ConfigChunk) {
    option (google.api.http) = { post: "/api/v1/config/export" body: "*" };
  }
  rpc ImportConfig(stream ConfigChunk) returns (ImportResult) {
    option (google.api.http) = { post: "/api/v1/config/import" body: "*" };
  }
}
```

---

## proto/plugin.proto

```protobuf
syntax = "proto3";

package rioku.v1;

option go_package = "github.com/riokulabs/rioku/proto/gen/go/rioku/v1;riokuv1";

import "google/protobuf/timestamp.proto";
import "google/protobuf/struct.proto";
import "google/api/annotations.proto";
import "rioku/v1/common.proto";

enum PluginType {
  PLUGIN_TYPE_UNSPECIFIED = 0;
  PLUGIN_TYPE_TRAFFIC     = 1;
  PLUGIN_TYPE_MIDDLEWARE  = 2;
  PLUGIN_TYPE_CLI         = 3;
  PLUGIN_TYPE_WEB         = 4;
  PLUGIN_TYPE_AGENTIC     = 5;
}

enum PluginStatus {
  PLUGIN_STATUS_UNSPECIFIED = 0;
  PLUGIN_STATUS_INSTALLING  = 1;
  PLUGIN_STATUS_ACTIVE      = 2;
  PLUGIN_STATUS_DISABLED    = 3;
  PLUGIN_STATUS_ERROR       = 4;
  PLUGIN_STATUS_REBUILDING  = 5;
}

message Plugin {
  string                    id            = 1;
  string                    name          = 2;
  string                    version       = 3;
  PluginType                type          = 4;
  repeated string           caddy_deps    = 5;
  google.protobuf.Struct    config_schema = 6;
  google.protobuf.Struct    config        = 7;
  PluginStatus              status        = 8;
  string                    module_path   = 9;
  Labels                    labels        = 10;
  google.protobuf.Timestamp installed_at  = 11;
  google.protobuf.Timestamp updated_at   = 12;
}

message ListPluginsRequest {
  PluginType   type   = 1;
  PluginStatus status = 2;
  PageRequest  page   = 3;
}

message PluginList { repeated Plugin plugins = 1; PageResponse page = 2; }

message InstallRequest {
  string                 module_path    = 1;
  google.protobuf.Struct initial_config = 2;
  bool                   defer_build    = 3;
}

message InstallEvent {
  enum Stage {
    STAGE_UNSPECIFIED = 0;
    STAGE_RESOLVING   = 1;
    STAGE_FETCHING    = 2;
    STAGE_VALIDATING  = 3;
    STAGE_BUILDING    = 4;
    STAGE_SWAPPING    = 5;
    STAGE_COMPLETE    = 6;
    STAGE_FAILED      = 7;
  }
  Stage                     stage       = 1;
  string                    message     = 2;
  string                    error       = 3;
  Plugin                    plugin      = 4;
  google.protobuf.Timestamp occurred_at = 5;
}

message RemoveRequest  { string plugin_id = 1; bool purge_config = 2; bool defer_build = 3; }
message RemoveResult   { MutationMeta meta = 1; bool rebuild_triggered = 2; }

message PluginConfigRequest { string plugin_id = 1; }
message PluginConfig {
  string                    plugin_id  = 1;
  google.protobuf.Struct    config     = 2;
  google.protobuf.Struct    schema     = 3;
  google.protobuf.Timestamp updated_at = 4;
}

message SetPluginConfigRequest {
  string                 plugin_id = 1;
  google.protobuf.Struct config    = 2;
  bool                   merge     = 3;
}
message SetResult {
  MutationMeta           meta   = 1;
  google.protobuf.Struct config = 2;
}

service PluginService {
  rpc ListPlugins(ListPluginsRequest) returns (PluginList) {
    option (google.api.http) = { get: "/api/v1/plugins" };
  }
  rpc InstallPlugin(InstallRequest) returns (stream InstallEvent) {
    option (google.api.http) = { post: "/api/v1/plugins" body: "*" };
  }
  rpc RemovePlugin(RemoveRequest) returns (RemoveResult) {
    option (google.api.http) = { delete: "/api/v1/plugins/{plugin_id}" };
  }
  rpc GetPluginConfig(PluginConfigRequest) returns (PluginConfig) {
    option (google.api.http) = { get: "/api/v1/plugins/{plugin_id}/config" };
  }
  rpc SetPluginConfig(SetPluginConfigRequest) returns (SetResult) {
    option (google.api.http) = { put: "/api/v1/plugins/{plugin_id}/config" body: "*" };
  }
}
```

---

## proto/build.proto

```protobuf
syntax = "proto3";

package rioku.v1;

option go_package = "github.com/riokulabs/rioku/proto/gen/go/rioku/v1;riokuv1";

import "google/protobuf/timestamp.proto";
import "google/api/annotations.proto";
import "rioku/v1/common.proto";

enum BuildTarget {
  BUILD_TARGET_UNSPECIFIED = 0;
  BUILD_TARGET_CADDY       = 1;
  BUILD_TARGET_DAEMON      = 2;
}

enum BuildState {
  BUILD_STATE_UNSPECIFIED   = 0;
  BUILD_STATE_IDLE          = 1;
  BUILD_STATE_TRIGGERED     = 2;
  BUILD_STATE_FETCHING_DEPS = 3;
  BUILD_STATE_BUILDING      = 4;
  BUILD_STATE_TESTING       = 5;
  BUILD_STATE_SWAPPING      = 6;
  BUILD_STATE_COMPLETE      = 7;
  BUILD_STATE_FAILED        = 8;
}

message BuildRecord {
  string                    id            = 1;
  BuildTarget               target        = 2;
  BuildState                state         = 3;
  repeated string           plugin_ids    = 4;
  string                    artifact_hash = 5;
  string                    log           = 6;
  string                    error         = 7;
  string                    build_service = 8;
  google.protobuf.Timestamp triggered_at  = 9;
  google.protobuf.Timestamp completed_at  = 10;
}

message BuildRequest   { BuildTarget target = 1; repeated string plugin_ids = 2; bool force = 3; }
message BuildEvent {
  BuildState                state       = 1;
  string                    message     = 2;
  string                    log_line    = 3;
  string                    error       = 4;
  BuildRecord               record      = 5;
  google.protobuf.Timestamp occurred_at = 6;
}
message BuildStatusRequest { string build_id = 1; }
message BuildStatus        { BuildRecord caddy_build = 1; BuildRecord daemon_build = 2; }
message SwapRequest        { string build_id = 1; bool dry_run = 2; }
message SwapResult {
  bool   success    = 1;
  string error      = 2;
  string build_id   = 3;
  string prior_hash = 4;
  string new_hash   = 5;
  google.protobuf.Timestamp swapped_at = 6;
}

service BuildService {
  rpc TriggerBuild(BuildRequest) returns (stream BuildEvent) {
    option (google.api.http) = { post: "/api/v1/build" body: "*" };
  }
  rpc GetBuildStatus(BuildStatusRequest) returns (BuildStatus) {
    option (google.api.http) = { get: "/api/v1/build" };
  }
  rpc SwapBinary(SwapRequest) returns (SwapResult) {
    option (google.api.http) = { post: "/api/v1/build/{build_id}/swap" body: "*" };
  }
}
```

---

## proto/cluster.proto

```protobuf
syntax = "proto3";

package rioku.v1;

option go_package = "github.com/riokulabs/rioku/proto/gen/go/rioku/v1;riokuv1";

import "google/protobuf/timestamp.proto";
import "google/api/annotations.proto";
import "rioku/v1/common.proto";

enum NodeRole {
  NODE_ROLE_UNSPECIFIED = 0;
  NODE_ROLE_BOOTSTRAP   = 1;
  NODE_ROLE_MEMBER      = 2;
}

enum NodeState {
  NODE_STATE_UNSPECIFIED = 0;
  NODE_STATE_JOINING     = 1;
  NODE_STATE_ACTIVE      = 2;
  NODE_STATE_DEGRADED    = 3;
  NODE_STATE_LEAVING     = 4;
  NODE_STATE_UNREACHABLE = 5;
}

message Node {
  string                    id               = 1;
  string                    name             = 2;
  string                    address          = 3;
  NodeRole                  role             = 4;
  NodeState                 state            = 5;
  string                    caddy_version    = 6;
  string                    daemon_version   = 7;
  string                    store_mode       = 8;
  bool                      is_leader        = 9;
  HealthState               health           = 10;
  string                    cert_fingerprint = 11;
  Labels                    labels           = 12;
  google.protobuf.Timestamp joined_at        = 13;
  google.protobuf.Timestamp last_seen_at     = 14;
}

message JoinRequest  {
  string node_address  = 1;
  string node_name     = 2;
  bytes  csr_pem       = 3;
  string ca_fingerprint = 4;
}
message JoinResult   {
  bytes          node_cert_pem = 1;
  bytes          ca_cert_pem   = 2;
  string         node_id       = 3;
  repeated Node  members       = 4;
}
message LeaveRequest { string node_id = 1; bool deregister = 2; }
message LeaveResult  { MutationMeta meta = 1; }

message ListNodesRequest { NodeState state = 1; PageRequest page = 2; }
message NodeList         { repeated Node nodes = 1; PageResponse page = 2; }

message SyncRequest  { string node_id = 1; int64 synced_version = 2; HealthState caddy_health = 3; }
message SyncResult   { int64 leader_version = 1; bool full_sync_required = 2; }

message ClusterEvent {
  enum Type {
    TYPE_UNSPECIFIED       = 0;
    TYPE_NODE_JOINED       = 1;
    TYPE_NODE_LEFT         = 2;
    TYPE_NODE_STATE_CHANGE = 3;
    TYPE_LEADER_CHANGE     = 4;
    TYPE_QUORUM_LOST       = 5;
    TYPE_QUORUM_RESTORED   = 6;
  }
  Type                      type                  = 1;
  string                    node_id               = 2;
  NodeState                 old_state             = 3;
  NodeState                 new_state             = 4;
  string                    new_leader_id         = 5;
  int32                     cluster_size          = 6;
  int32                     expected_cluster_size = 7;
  string                    message               = 8;
  google.protobuf.Timestamp occurred_at           = 9;
}

service ClusterService {
  rpc Join(JoinRequest) returns (JoinResult) {
    option (google.api.http) = { post: "/api/v1/cluster/join" body: "*" };
  }
  rpc Leave(LeaveRequest) returns (LeaveResult) {
    option (google.api.http) = { post: "/api/v1/cluster/leave" body: "*" };
  }
  rpc ListNodes(ListNodesRequest) returns (NodeList) {
    option (google.api.http) = { get: "/api/v1/cluster/nodes" };
  }
  // Internal only — no REST annotation.
  rpc SyncState(SyncRequest) returns (SyncResult);
  // SSE at REST: GET /api/v1/events/cluster
  rpc WatchCluster(WatchClusterRequest) returns (stream ClusterEvent);
}
```

> **Note:** `WatchCluster` uses a dedicated `WatchClusterRequest` message (empty), not the shared `WatchRequest` from config.proto.

---

## proto/health.proto

```protobuf
syntax = "proto3";

package rioku.v1;

option go_package = "github.com/riokulabs/rioku/proto/gen/go/rioku/v1;riokuv1";

import "google/protobuf/timestamp.proto";
import "google/api/annotations.proto";
import "rioku/v1/common.proto";

message HealthRequest   { bool verbose = 1; }
message HealthStatus {
  HealthState               overall        = 1;
  SubsystemHealth           store          = 2;
  SubsystemHealth           caddy          = 3;
  SubsystemHealth           cluster        = 4;
  SubsystemHealth           certmgr        = 5;
  string                    version        = 6;
  int64                     uptime_seconds = 7;
  google.protobuf.Timestamp checked_at     = 8;
}
message SubsystemHealth {
  HealthState          state   = 1;
  string               message = 2;
  map<string, string>  detail  = 3;
}
message CaddyStatusRequest {}
message CaddyStatus {
  HealthState               state                = 1;
  string                    version              = 2;
  bool                      running              = 3;
  int32                     pid                  = 4;
  int64                     loaded_config_version = 5;
  int32                     upstreams_healthy    = 6;
  int32                     upstreams_total      = 7;
  google.protobuf.Timestamp checked_at           = 8;
}

service HealthService {
  rpc GetHealth(HealthRequest) returns (HealthStatus) {
    option (google.api.http) = { get: "/api/v1/health" };
  }
  rpc GetCaddyStatus(CaddyStatusRequest) returns (CaddyStatus) {
    option (google.api.http) = { get: "/api/v1/health/caddy" };
  }
}
```

---

## Design Notes

### Conventions applied throughout

- All timestamps use `google.protobuf.Timestamp` — translated to RFC3339 automatically by grpc-gateway at the REST layer.
- All entity IDs are UUIDv4 strings.
- All errors use `google.rpc.Status` via standard gRPC status codes — grpc-gateway maps these to correct HTTP status codes automatically.
- REST annotations (`google.api.http`) are only on RPCs that should be externally reachable. Internal-only RPCs (`SyncState`, `WatchChanges`, `WatchCluster`) have no REST annotation.
- Streaming RPCs that translate to SSE at the REST layer are noted inline.

### Key design decisions

**`ConfigChange` uses a single oneof RPC** rather than separate create/update/delete RPCs per entity. One RPC = one audit entry = one config version increment = one wire call.

**`WatchChanges` sends a full snapshot on connect** before streaming incremental events. The SPA never needs to call `GetConfig` separately — it gets a consistent starting state from the stream automatically.

**`JoinRequest` carries the CSR** because the PKI and cluster join flows are operationally coupled. Separating them would require two round trips with a window where a node has joined but has no cert.

**`SyncState` has no REST annotation** — it is a daemon-to-daemon internal RPC only. grpc-gateway will not generate a REST endpoint for it.

---

## proto/traffic.proto

TrafficService is fully defined — see [ai-and-agentic.md](ai-and-agentic.md) section 5 for the complete proto definition including `RequestTrace`, `AITrace`, `TrafficStats`, `TokenStats`, `AgentSession`, and all query/watch messages.

The service exposes 7 RPCs:

```protobuf
service TrafficService {
  rpc WatchTraffic(WatchTrafficRequest) returns (stream RequestTrace);
  rpc QueryTraces(TraceQuery) returns (TraceQueryResult);
  rpc GetTrace(GetTraceRequest) returns (RequestTrace);
  rpc GetStats(StatsQuery) returns (TrafficStats);
  rpc GetTokenStats(TokenQuery) returns (TokenStats);
  rpc ListSessions(SessionQuery) returns (SessionList);
  rpc GetSession(GetSessionRequest) returns (SessionDetail);
}
```
