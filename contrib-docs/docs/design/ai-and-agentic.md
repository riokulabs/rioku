# Rioku — AI-First Architecture & Admin Panel Design

**Version:** 0.2
**Status:** Partially implemented (see inline status markers)
**Last Updated:** 2026-04-09

---

## 1. Scope

This document covers the design for AI-related capabilities. Implementation status:

| Component | Status |
|-----------|--------|
| TraceStore interface + SQLite driver | ✅ Implemented |
| TraceStore ring buffer + ingester + aggregator | ✅ Implemented |
| AI pricing table | ✅ Implemented |
| TrafficService proto | ✅ Defined (gRPC server registration in progress) |
| Auth/session system with RBAC | ✅ Implemented |
| Admin panel (React 19 + TanStack) | ✅ Implemented |
| LLM proxy plugin | 🔲 Stub only |
| Semantic rate limiting | 🔲 Stub only |
| Tool call routing | 🔲 Stub only |
| Agent identity | 🔲 Stub only |
| MCP server | 🔲 Package declaration only (4 lines) |
| RegistrationService | 🔲 Not yet in proto |

---

## 2. AI-First Architecture

The two AI angles — agents managing Rioku, and Rioku as infrastructure for AI workloads — are the same product story told from different directions. An operator uses an AI agent to configure their LLM proxy. The gateway routes that LLM traffic, enforces token budgets, and traces the agent sessions. The MCP server and the LLM proxy are the same deployment.

---

### 2.1 LLM Proxy / Router

Rioku sits in front of LLM providers as a traffic plugin, giving operators control over routing, auth, and cost that currently has nowhere to live.

**Request flow:**

```
Client request
    |
    ▼
Rioku LLM Proxy (traffic plugin)
    |
    ├── Parse request body (model, messages, max_tokens, stream)
    ├── Apply routing policy (which provider/model gets this request)
    ├── Apply rate limiting (token budget, request count)
    ├── Apply auth (which API keys can call which models)
    ├── Inject/strip headers (add org API key, remove client key)
    |
    ▼
    ├── Route A: Anthropic  (claude-opus-4-5 for complex requests)
    ├── Route B: OpenAI     (gpt-4o for standard requests)
    ├── Route C: Ollama     (llama3 for internal/cheap requests)
    └── Route D: Fallback   (if primary provider returns 429/500)
```

**Routing policies:**

- **Model routing by cost** — classify by estimated complexity and route to appropriate model tier
- **Provider fallback** — transparent retry on alternate provider if primary returns 429/5xx
- **A/B routing** — send percentage of traffic to a new model for evaluation
- **Per-key model restrictions** — API key X can only call Haiku, key Y can call any model
- **Semantic routing** — route by detected intent (Phase 5+, adds latency via embedding call)

**OpenAI-compatible endpoint:**

The de facto standard is `POST /v1/chat/completions`. Every client library (LangChain, LlamaIndex, Instructor) speaks this. Rioku exposes this endpoint and translates to the target provider format:

```
POST /v1/chat/completions (OpenAI format)
    |
    ▼
Rioku translates to target:
    - Anthropic:  POST /v1/messages      (different schema)
    - OpenAI:     pass-through
    - Ollama:     POST /api/chat          (different schema)
    - Compatible: pass-through
```

Translation handles both request and response format differences including streaming SSE format differences between providers.

---

### 2.2 Semantic Rate Limiting

Standard rate limiting counts requests. AI workloads need token-based limiting because a single request can consume vastly different amounts of compute.

**Three dimensions per identity (user, agent, API key, org):**

```
- requests/minute        (standard)
- input tokens/minute    (what the client sends)
- output tokens/minute   (what the model generates)
- total tokens/day       (budget enforcement)
- cost/day               (dollar-denominated budget)
```

**Streaming response handling:**

For non-streaming requests, token counts arrive in `usage.prompt_tokens` and `usage.completion_tokens`. For streaming, the count arrives in the final chunk. The rate limiter must:

1. Estimate tokens from the request before sending
2. Pass the stream through while accumulating the usage chunk in parallel
3. Reconcile estimate vs actual after stream completes — carry forward the delta

The client sees no buffering. Reconciliation is asynchronous. Conservative estimation on the request side mitigates the race window.

---

### 2.3 Tool Call Routing

When an LLM responds with a `tool_use` / `function_call`, Rioku can intercept and route the tool call directly — acting as a tool execution proxy.

```
LLM response with tool_call:
{
  "tool_use": {
    "name": "search_database",
    "input": { "query": "..." }
  }
}
    |
    ▼
Rioku Tool Router (middleware plugin):
    - Inspect response body for tool_call blocks
    - Look up "search_database" in tool registry
    - Route to registered tool endpoint
    - Return tool result back to the stream
    - Continue conversation automatically (optional)
```

**Tool registry** — new entity in the config store:

```sql
tools:
    id          UUID
    name        VARCHAR(128)  – matches tool_call name
    endpoint    VARCHAR(512)  – where to route the call
    schema      JSONB         – JSON Schema for input validation
    policy_ids  UUID[]        -- auth/rate limit policies on tool calls
    enabled     BOOLEAN
```

This is a first-class proto entity requiring a `ToolService` with CRUD and `RegisterTool` RPC.

---

### 2.4 Agent Identity & Session Tracking

Standard API auth is designed for human users or service accounts. AI agents have different characteristics:

- An agent may act on behalf of a human user (delegated identity)
- An agent session spans multiple requests (conversation continuity)
- An agent's actions should be traceable as a unit
- An agent may spawn sub-agents (hierarchical identity)

**Agent identity model:**

```go
type AgentIdentity struct {
    ID             string    // stable agent ID
    Name           string    // e.g. "customer-support-bot"
    ParentAgentID  string    // for sub-agents
    UserID         string    // human user this agent acts on behalf of
    SessionID      string    // current conversation session
    Scopes         []string  // what this agent is allowed to do
    ModelPolicy    string    // which models this agent can use
    TokenBudget    int64     // tokens/day budget
    ExpiresAt      time.Time
}
```

**Session tracking:**

Each agent session gets a `session_id` propagated via `X-Rioku-Session-ID` header. Enables:

- Per-session token accounting
- Per-session audit trail (full conversation trace)
- Per-session rate limiting
- Anomaly detection (session consuming 10x normal tokens)

---

### 2.5 MCP Server

Rioku exposes its own capabilities as MCP tools that AI agents can call. Runs inside the daemon, exposed via the REST gateway at `/mcp/v1/`.

**Exposed tools:**

```
rioku_list_routes         → ConfigService.GetConfig (routes)
rioku_create_route        → ConfigService.ApplyChange (RouteOp.UPSERT)
rioku_update_route        → ConfigService.ApplyChange (RouteOp.UPSERT)
rioku_delete_route        → ConfigService.ApplyChange (RouteOp.DELETE)
rioku_list_services       → ConfigService.GetConfig (services)
rioku_create_service      → ConfigService.ApplyChange (ServiceOp.UPSERT)
rioku_list_policies       → ConfigService.GetConfig (policies)
rioku_apply_policy        → ConfigService.ApplyChange (PolicyOp.UPSERT)
rioku_get_health          → HealthService.GetHealth
rioku_list_nodes          → ClusterService.ListNodes
rioku_get_audit_log       → ConfigService.GetAuditLog
rioku_install_plugin      → PluginService.InstallPlugin
rioku_list_plugins        → PluginService.ListPlugins
rioku_get_traffic_stats   → TrafficService.GetStats
rioku_get_token_stats     → TrafficService.GetTokenStats
```

**Implementation:** MCP server wraps existing gRPC service implementations. Tool schemas are generated from proto definitions — same validation as the REST API, no separate logic.

**Authentication:** MCP tool calls carry the same Bearer token as the REST API. Agent API keys are scoped to specific tools via RBAC.

**Example interaction:**

```
Human: "Add rate limiting to the /api/v1/llm route —
        100 requests per minute per API key"

Agent (via MCP):
1. rioku_list_routes  → finds route ID for /api/v1/llm
2. rioku_list_policies  → checks if matching rate limit policy exists
3. rioku_create_policy → creates rate_limit policy (100 req/min, per-key)
4. rioku_update_route → attaches policy to route
5. Returns: "Done. Rate limit policy applied to /api/v1/llm"

Audit log actor: "claude-agent-xyz"
```

---

### 2.6 RegistrationService — 🔲 NOT YET IMPLEMENTED

Applications self-registering their routes on startup. Proto not yet defined — design only.

```protobuf
service RegistrationService {
  rpc Register(RegisterRequest) returns (RegisterResult);
  rpc Deregister(DeregisterRequest) returns (DeregisterResult);
  rpc Heartbeat(HeartbeatRequest) returns (HeartbeatResult);
  rpc ListRegistrations(ListRegistrationsRequest) returns (ListRegistrationsResult);
}

message RegisterRequest {
  string           service_name  = 1;  // e.g. "payments-api"
  string           instance_id   = 2;  // unique per-instance (hostname+port)
  string           address       = 3;  // host:port this instance listens on
  repeated RouteSpec routes       = 4;
  HealthCheckSpec   health_check  = 5;
  repeated string   policy_ids   = 6;
  Labels           labels        = 7;
  int32            ttl_seconds   = 8;  // heartbeat TTL, default 30s
}

message RouteSpec {
  repeated Matcher matchers = 1;
  TLSMode        tls      = 2;
  int32          weight   = 3;
}
```

**Lifecycle:**

1. App starts → calls `Register` with address and route specs
2. Rioku creates/updates `Service` entry with app as upstream, creates declared routes
3. App sends `Heartbeat` every 15 seconds
4. Heartbeats stop for TTL duration → upstream marked unhealthy (route preserved)
5. App calls `Deregister` on clean shutdown → upstream removed immediately

Multiple instances of the same service register independently. Rioku automatically pools them as upstreams under the same service entry.

---

## 3. Request Trace Persistence

### 3.1 TraceStore Interface

Traces have a fundamentally different access pattern from config: high-write, append-only, large dataset, time-range and aggregation queries. They live in a **separate store** from the config database.

```go
// internal/tracestore/store.go

type TraceStore interface {
    WriteTrace(ctx context.Context, trace RequestTrace) error
    WriteTraces(ctx context.Context, traces []RequestTrace) error

    QueryTraces(ctx context.Context, q TraceQuery) ([]RequestTrace, error)
    GetTrace(ctx context.Context, traceID string) (*RequestTrace, error)

    GetStats(ctx context.Context, q StatsQuery) (*TrafficStats, error)
    GetTokenUsage(ctx context.Context, q TokenQuery) (*TokenStats, error)

    Prune(ctx context.Context, olderThan time.Duration) (int64, error)

    Open(ctx context.Context, cfg TraceStoreConfig) error
    Close() error
}
```

**Implementations:**

| Implementation | Status | Use case |
|---|---|---|
| `sqliteTraceStore` | ✅ Implemented | In-process, good for low-to-moderate traffic |

> **Note:** DuckDB was originally planned as a Phase 2+ driver but was rejected (see decision log, 2026-04-09) due to CGo dependency. The TraceStore uses pre-aggregated buckets and ring buffer ingestion to achieve good analytics performance on SQLite. A future alternative analytical backend may be considered if SQLite proves insufficient at scale.

### 3.2 RequestTrace Schema

```go
type RequestTrace struct {
    // Identity
    TraceID         string
    SpanID          string    // for distributed tracing correlation
    SessionID       string    // agent session ID if present

    // Timing
    StartedAt       time.Time
    Duration        time.Duration
    UpstreamDuration time.Duration

    // Request
    Method          string
    Path            string
    Host            string
    RouteID         string
    ServiceID       string
    UpstreamAddr    string

    // Response
    StatusCode      int
    BytesSent       int64
    BytesRecv       int64

    // Identity
    ActorID         string    // API key ID or agent ID
    ActorType       string    // "api_key" | "agent" | "anonymous"

    // Policies applied
    PolicyIDs       []string
    RateLimitHit    bool
    AuthResult      string    // "pass" | "fail" | "bypass"

    // AI fields (nil for non-AI requests)
    AI              *AITrace
}

type AITrace struct {
    Provider        string
    Model           string
    InputTokens     int64
    OutputTokens    int64
    CacheHitTokens  int64
    TotalTokens     int64
    EstimatedCost   float64  // USD
    IsStreaming      bool
    FinishReason    string   // "stop" | "max_tokens" | "tool_use" | ...
    ToolCalls       []ToolCallTrace

    Truncated       bool     // message content truncated for storage

    AgentID         string
    TurnNumber      int
    ParentTraceID   string   // previous turn in session
}

type ToolCallTrace struct {
    ToolName  string
    ToolID    string
    Duration  time.Duration
    Success   bool
    Error     string
}
```

`Truncated` is important — message content is NOT stored by default (privacy, storage cost). The trace stores metadata and token counts. Message content is opt-in, controlled by config, and redactable by policy.

### 3.3 `rioku.yaml` Trace Config

```yaml
traces:
  store: sqlite            # sqlite | duckdb
  path: /var/lib/rioku/traces

  retention:
    request_traces: 7d      # raw request traces
    ai_sessions: 30d        # agent sessions retained longer
    aggregates: 90d         # hourly/daily rollups kept longest

  sampling:
    rate: 1.0               # 1.0 = 100%, 0.1 = 10%
    ai_always: true         # always trace AI requests regardless of rate
    min_duration_ms: 0      # 0 = trace all, N = only trace requests > N ms

  content:
    store_messages: false   # store actual LLM message content
    redact_patterns:        # regex patterns applied to stored content
      - '\b\d{4}[- ]?\d{4}[-]?\d{4}[-]?\d{4}\b'  # credit cards
      - '\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z]{2,}\b'  # emails

  max_size_gb: 10
```

---

## 4. AI Pricing Table

### 4.1 Design

Default pricing is built into the daemon binary and updated with each Rioku release. Operators can override per-model in `rioku.yaml`.

**Pricing resolution order:**

1. `rioku.yaml` custom models (exact match)
2. `rioku.yaml` overrides (exact match)
3. Built-in table (exact match)
4. Built-in table (prefix match — `claude-*` falls back to closest known model)
5. Zero cost with warning (unknown model — never silently wrong)

### 4.2 Built-In Table (as of 2026-04-02)

```go
// internal/ai/pricing/table.go
// Prices in USD per 1M tokens.

var DefaultPricingTable = PricingTable{
    Version: "2026-04-02",
    Models: map[string]ModelPricing{
        // Anthropic
        "claude-opus-4-5": {
            InputPer1M:      15.00,
            OutputPer1M:     75.00,
            CacheWritePer1M: 18.75,
            CacheReadPer1M:  1.50,
        },
        "claude-sonnet-4-5": {
            InputPer1M:      3.00,
            OutputPer1M:     15.00,
            CacheWritePer1M: 3.75,
            CacheReadPer1M:  0.30,
        },
        "claude-haiku-4-5": {
            InputPer1M:      0.80,
            OutputPer1M:     4.00,
            CacheWritePer1M: 1.00,
            CacheReadPer1M:  0.08,
        },
        // OpenAI
        "gpt-4o": {
            InputPer1M:  5.00,
            OutputPer1M: 15.00,
        },
        "gpt-4o-mini": {
            InputPer1M:  0.15,
            OutputPer1M: 0.60,
        },
        "o1": {
            InputPer1M:  15.00,
            OutputPer1M: 60.00,
        },
    },
}
```

### 4.3 `rioku.yaml` Pricing Config

```yaml
ai:
  pricing:
    auto_update: false       # pull updated table from feed_url
    feed_url: https://pricing.rioku.dev/table.json  # self-hostable
    update_interval: 24h

    # Override built-in prices (e.g. enterprise agreement)
    overrides:
      claude-opus-4-5:
        input_per_1m: 12.00
        output_per_1m: 60.00

    # Custom / self-hosted models
    custom:
      - model: "ollama/llama3-70b"
        input_per_1m: 0.10   # GPU cost estimate
        output_per_1m: 0.40
      - model: "internal/fine-tuned-v2"
        input_per_1m: 0.50
        output_per_1m: 2.00

    currency: USD            # display only, all calcs in USD
```

**Pricing feed:** The feed URL is self-hostable for air-gapped environments. Feed is a signed JSON document in the same format as the built-in table. Daemon verifies the signature before applying updates.

---

## 5. TrafficService Proto

```protobuf
syntax = "proto3";
package rioku.v1;
option go_package = "github.com/riokulabs/rioku/proto/gen/go/rioku/v1;riokuv1";

import "google/protobuf/timestamp.proto";
import "google/api/annotations.proto";
import "rioku/v1/common.proto";

// ———— Entities
// ————————————————————————————————————————————————

message RequestTrace {
  string  trace_id             = 1;
  string  span_id              = 2;
  string  session_id           = 3;

  google.protobuf.Timestamp started_at = 4;
  int64   duration_ms          = 5;
  int64   upstream_duration_ms = 6;

  string  method               = 7;
  string  path                 = 8;
  string  host                 = 9;
  string  route_id             = 10;
  string  service_id           = 11;
  string  upstream_addr        = 12;

  int32   status_code          = 13;
  int64   bytes_sent           = 14;
  int64   bytes_recv           = 15;

  string  actor_id             = 16;
  string  actor_type           = 17;  // "api_key" | "agent" | "anonymous"

  repeated string policy_ids   = 18;
  bool    rate_limit_hit       = 19;
  string  auth_result          = 20;  // "pass" | "fail" | "bypass"

  AITrace ai                   = 21;  // nil for non-AI requests
}

message AITrace {
  string  provider             = 1;
  string  model                = 2;
  int64   input_tokens         = 3;
  int64   output_tokens        = 4;
  int64   cache_hit_tokens     = 5;
  int64   total_tokens         = 6;
  double  estimated_cost_usd   = 7;
  bool    is_streaming         = 8;
  string  finish_reason        = 9;
  repeated ToolCallTrace tool_calls = 10;
  bool    content_truncated    = 11;

  string  agent_id             = 12;
  int32   turn_number          = 13;
  string  parent_trace_id      = 14;
}

message ToolCallTrace {
  string tool_name  = 1;
  string tool_id    = 2;
  int64  duration_ms = 3;
  bool   success    = 4;
  string error      = 5;
}

// ———— Watch
// ————————————————————————————————————————————————

message WatchTrafficRequest {
  repeated string route_ids    = 1;  // empty = all routes
  repeated int32  status_codes = 2;
  bool            ai_only     = 3;
  int64           min_duration_ms = 4;
}

// ———— Query
// ————————————————————————————————————————————————

message TraceQuery {
  google.protobuf.Timestamp since       = 1;
  google.protobuf.Timestamp until       = 2;
  repeated string           route_ids   = 3;
  repeated int32            status_codes = 4;
  string                    actor_id    = 5;
  string                    session_id  = 6;
  bool                      ai_only    = 7;
  PageRequest               page       = 8;
}

message TraceQueryResult {
  repeated RequestTrace traces = 1;
  PageResponse          page   = 2;
}

// ———— Stats
// ————————————————————————————————————————————————

message StatsQuery {
  google.protobuf.Timestamp since     = 1;
  google.protobuf.Timestamp until     = 2;
  string                    interval  = 3;  // "minute" | "hour" | "day"
  repeated string           route_ids = 4;
}

message TrafficStats {
  repeated StatsBucket buckets = 1;
}

message StatsBucket {
  google.protobuf.Timestamp bucket_start = 1;
  int64  request_count  = 2;
  int64  error_count    = 3;
  double error_rate     = 4;
  int64  p50_latency_ms = 5;
  int64  p95_latency_ms = 6;
  int64  p99_latency_ms = 7;
  int64  bytes_sent     = 8;
  int64  bytes_recv     = 9;
}

// ———— Token / AI Stats
// ————————————————————————————————————————————————

message TokenQuery {
  google.protobuf.Timestamp since    = 1;
  google.protobuf.Timestamp until    = 2;
  string                    interval = 3;
  string                    actor_id = 4;
  string                    model    = 5;
  string                    provider = 6;
}

message TokenStats {
  repeated TokenBucket     buckets         = 1;
  TokenTotals              totals          = 2;
  repeated ModelBreakdown  model_breakdown = 3;
}

message TokenBucket {
  google.protobuf.Timestamp bucket_start = 1;
  int64  input_tokens      = 2;
  int64  output_tokens     = 3;
  int64  total_tokens      = 4;
  double estimated_cost_usd = 5;
  int64  request_count     = 6;
}

message TokenTotals {
  int64  input_tokens      = 1;
  int64  output_tokens     = 2;
  int64  total_tokens      = 3;
  double estimated_cost_usd = 4;
  int64  request_count     = 5;
  double budget_used_pct   = 6;
}

message ModelBreakdown {
  string provider           = 1;
  string model              = 2;
  int64  total_tokens       = 3;
  double estimated_cost_usd = 4;
  int64  request_count      = 5;
}

// ———— Sessions
// ————————————————————————————————————————————————

message SessionQuery {
  bool                      active_only = 1;
  string                    agent_id    = 2;
  google.protobuf.Timestamp since       = 3;
  PageRequest               page        = 4;
}

message AgentSession {
  string session_id          = 1;
  string agent_id            = 2;
  string agent_name          = 3;
  int32  turn_count          = 4;
  int64  total_tokens        = 5;
  double estimated_cost_usd  = 6;
  bool   active              = 7;
  bool   anomalous           = 8;
  string anomaly_reason      = 9;
  google.protobuf.Timestamp started_at  = 10;
  google.protobuf.Timestamp last_seen_at = 11;
}

message SessionList {
  repeated AgentSession sessions = 1;
  PageResponse          page     = 2;
}

message SessionDetail {
  AgentSession         session = 1;
  repeated RequestTrace turns  = 2;  // ordered by turn_number
}

message GetTraceRequest   { string trace_id   = 1; }
message GetSessionRequest { string session_id = 1; }

// ———— Service
// ————————————————————————————————————————————————

service TrafficService {
  // Live stream. SSE at REST: GET /api/v1/events/traffic
  rpc WatchTraffic(WatchTrafficRequest) returns (stream RequestTrace);

  rpc QueryTraces(TraceQuery) returns (TraceQueryResult) {
    option (google.api.http) = { get: "/api/v1/traffic/traces" };
  }

  rpc GetTrace(GetTraceRequest) returns (RequestTrace) {
    option (google.api.http) = {
      get: "/api/v1/traffic/traces/{trace_id}"
    };
  }

  rpc GetStats(StatsQuery) returns (TrafficStats) {
    option (google.api.http) = { get: "/api/v1/traffic/stats" };
  }

  rpc GetTokenStats(TokenQuery) returns (TokenStats) {
    option (google.api.http) = { get: "/api/v1/traffic/tokens" };
  }

  rpc ListSessions(SessionQuery) returns (SessionList) {
    option (google.api.http) = { get: "/api/v1/traffic/sessions" };
  }

  rpc GetSession(GetSessionRequest) returns (SessionDetail) {
    option (google.api.http) = {
      get: "/api/v1/traffic/sessions/{session_id}"
    };
  }
}
```

---

## 6. Admin Panel Design

### 6.1 Navigation Architecture

Two personas (operators and developers) served by one panel with different natural entry points.

```
Rioku Admin
├── Overview              (both personas land here)
├── Traffic
│   ├── Live              (real-time request stream)
│   ├── Analytics         (aggregated metrics)
│   └── AI Workloads      (tokens, cost, model routing, agent traces)
├── Config
│   ├── Routes
│   ├── Services
│   ├── Policies
│   └── Editor            (raw config with validation)
├── Plugins
│   ├── Installed
│   └── Marketplace
├── Cluster
│   ├── Nodes
│   └── Health
├── Security
│   ├── API Keys
│   ├── Certificates
│   └── Audit Log
└── Settings
```

Operator persona: Config, Plugins, Cluster, Security.
Developer persona: Traffic, Overview.

### 6.2 Overview Dashboard

Answers "is everything OK right now?" in under 3 seconds.

```
┌─────────────────────┬──────────────────────┐
│  Traffic Health      │  Cluster Status      │
│                      │                      │
│  req/s    p99 lat    │  3/3 nodes healthy   │
│  [sparkline]         │  [node topology]     │
├──────────────────────┼──────────────────────┤
│  Error Rate          │  AI Workloads        │
│                      │                      │
│  0.02% errors        │  tokens/min          │
│  [sparkline]         │  active sessions     │
└──────────────────────┴──────────────────────┘
```

- Green/amber/red tied directly to `HealthState` from proto
- Sparklines for last 5 minutes (trend, not full charts)
- Clicking any quadrant deep-links to the relevant section
- No tables on overview — tables are for detail pages
- Auto-refreshes via `WatchChanges` SSE — never requires page reload

### 6.3 Live Traffic View

```
┌─────────────────────────────────────────────────┐
│  [Route filter  ▼]  [Status filter ▼]  [Search...]  ⏸  │
├──────┬────────┬───────┬────────┬─────────┬──────────┤
│ Time │ Method │ Path  │ Status │ Latency  Upstream│
├──────┼────────┼───────┼────────┼─────────┼──────────┤
│ 10:23│ POST   │ /v1/..│ 200    │ 342ms    svc-a:80│
├──────┼────────┼───────┼────────┼─────────┼──────────┤
│ 10:23│ GET    │ /heal..│ 200   │   2ms    svc-b:80│
└──────┴────────┴───────┴────────┴─────────┴──────────┘
```

- Powered by `WatchTraffic` SSE stream
- Pause button stops auto-scroll, not the stream (buffer in memory)
- Click any row to expand full `RequestTrace` detail
- AI requests show inline token count and cost badge
- Filter state preserved in URL query params
