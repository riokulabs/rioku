# D5: Conditional Routing DSL — CEL (Caddy Already Supports It)

**Date**: 2026-04-30
**Issues**: AI routing strategies (#168), per-route matchers (existing)
**Status**: Accepted

## Context

Rioku needs a conditional expression language at multiple layers:

- **Caddy matchers** already use [CEL][cel] via the `expression`
  matcher (see `Matcher.expression` in config.proto §matchers).
  Operators write things like `header.X-Tier == "gold"` to
  match a route under specific conditions.
- **AI routing strategies** (#168) eventually need a similar
  expression language to filter / weight upstreams (e.g.
  *"prefer cheap models when prompt > 1k tokens"*).
- **Rate-limit + access policies** (Sprint 3) need the same.

The question is whether Rioku adopts a single DSL or lets each
subsystem pick its own.

[cel]: https://github.com/google/cel-spec

## Decision

**CEL (the [Common Expression Language][cel-spec]) for every
conditional-expression slot.**

[cel-spec]: https://github.com/google/cel-spec

## Why

- **Caddy already ships it.** The `caddy-cel` matcher is part of
  the upstream Caddy build. Reusing it means zero new dependency
  weight in `bin/rioku-caddy`, and operator muscle memory from
  Caddy expressions transfers.
- **Sandbox semantics.** CEL is non-Turing-complete by design —
  bounded execution time, no syscalls, no I/O. Expressions in
  operator config can't accidentally (or maliciously) hang the
  daemon or open a side channel.
- **Mature tooling.** CEL has well-maintained Go bindings
  (`github.com/google/cel-go`), a stable spec, and is the
  language Envoy + Istio + Knative + Kubernetes admission
  controllers all standardised on. Operators carrying experience
  from those stacks won't have to relearn.
- **Type system.** CEL expressions can be typechecked against
  the input schema at config-save time. Caller surfaces
  (matchers, AI strategies, rate-limit) get their schema
  registered with the CEL environment so save-time errors point
  at the offending expression with a position-accurate message.
- **Rejected alternatives:**
  - **Lua / Starlark:** Turing-complete; need their own
    sandboxing layer.
  - **JavaScript / V8:** dependency weight, security surface.
  - **A bespoke DSL:** parser + evaluator + docs + grammar
    versioning are all expensive when CEL covers the
    requirements.

## Consequences

- **Single CEL environment per subsystem.** Each conditional
  slot (matcher, strategy filter, rate-limit scope) registers
  its own variable set + custom functions. The environments are
  not shared — that prevents one subsystem's helpers from
  leaking into another's namespace.
- **Cost guard at compile time.** Every CEL expression in
  config goes through `cel.Program.Eval` with a `cel.Limit`
  set per call site. Default limit is 100 instructions for
  matchers, 500 for AI strategy filters, 50 for rate-limit
  scopes — high enough for real expressions, low enough that
  pathological recursion / loops fail fast.
- **Validation at config save.** The config engine refuses to
  persist a route / strategy / policy whose CEL expressions
  fail typecheck. This pushes errors to admin save time
  rather than runtime where they'd produce silent rejects.
- **No JIT.** CEL expressions are interpreted; we don't compile
  to native. Sub-microsecond eval is fast enough for every
  call site we have. If a future call site needs hotter
  evaluation we revisit.
- **One library.** `github.com/google/cel-go` is added to the
  daemon's `go.mod` once. Caddy already pulls it transitively
  for the matcher; the daemon can reuse the dep tree.
- **Documentation:** every subsystem with a CEL slot ships a
  `cel.md` that lists its variable bindings + custom functions
  - cost limit. Operators get a concrete reference rather than
  having to read source code.
