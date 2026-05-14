---
sidebar_position: 1
---

# AI Coding Guidelines

Guidelines for using AI coding tools effectively on the Rioku project. This covers prompt templates, what to review carefully, and the testing philosophy that applies to AI-generated code.

For language and formatting rules enforced by linters, see the [Style Guide](../contributing/style-guide.md).

---

## AI Coding Strategy

### What AI Codes Well (Use Aggressively)

- Proto definitions and generated code
- React + TanStack admin panel components given a clear API spec
- SQL migrations given a clear schema spec
- CLI command implementations given clear interface contracts
- Configuration file parsing (`rioku.yaml`)
- HTTP handler boilerplate
- Test scaffolding for happy paths
- Documentation from existing specs

### What AI Codes Badly (Review Carefully)

- Goroutine lifecycle management — leaks, improper cancellation, missing `defer cancel()`
- Complex sync primitives — GaleraPool's `sync.RWMutex` usage will have races
- Error handling chains — tends to discard errors or log-and-continue
- Distributed systems edge cases — split-brain detection, cert rotation under load
- Security-sensitive code — keyring backends, JWT validation, TLS config builders
- Tests for adversarial conditions — AI tests happy paths; chaos must be human-designed

### Standard Coding Prompt Template

Never ask AI to write a large chunk of code. One function at a time, with a clear contract.

```text
Context:
- File: [path]
- Package: [package name]
- This function is called by: [caller description]
- Related types already defined: [paste relevant types]

Task:
Write [specific function name] on [type].

Requirements:
1. [Requirement 1]
2. [Requirement 2]
3. [Requirement 3]

Do not write:
- Tests (asking separately)
- [Other adjacent code]
- Any logging (adding separately)

Return:
- The method implementation only
- A one-paragraph explanation of the concurrency approach used
  (if the function involves concurrency)
```

### Standard Testing Prompt Template

```text
Context:
- Function under test: [function signature]
- [paste the implementation]

Task:
Write a table-driven test for [function] in Go.

Test cases must include:
1. Happy path: [description]
2. [Edge case]: [description]
3. [Error case]: [description]
4. [Concurrent case]: N goroutines calling simultaneously, no data races
   (use t.Parallel() and the -race flag)
5. [State change mid-operation case if applicable]

Do not use:
- External test libraries (standard library only)
- Mocks of external systems (use real in-process state)

Each test case must:
- Have a descriptive name
- Set up state explicitly (no shared state between cases)
- Assert the specific error type on failure cases, not just err != nil
```

### Concurrent / Distributed Code Review Prompt Addition

Append this to any prompt involving goroutines, mutexes, or distributed state:

```text
After writing this code, review it for:
1. Goroutine leaks — every goroutine started must have a clear exit condition
2. Context cancellation — ctx.Done() must be checked in any loop or
   blocking operation
3. Lock ordering — if multiple mutexes are held, document the order
4. Error handling — every error must be explicitly handled, not discarded

Flag any of these issues in your explanation even if you could not resolve them.
```

### Testing Philosophy

Treat tests as the primary deliverable. The implementation is a means to making tests pass.

**Four test layers:**

| Layer | Scope | AI Generates? | Homelab Required? |
|---|---|---|---|
| Unit | Single function, no external deps, fast | Yes, with prompts above | No |
| Integration | Real SQLite/Postgres/MariaDB, real filesystem | Partially | Yes |
| Chaos | Kill processes mid-op, partition network, expire certs | No — human-designed | Yes |
| Regression | Every production bug gets a test before the fix | Partially | Depends |

**The most important test in the project:**

A test verifying Rioku continues serving traffic correctly when the config store is completely unreachable. This is the degraded mode guarantee. Enterprise operators will ask about this first. Write it before the degraded mode implementation, not after.

**Non-negotiable testing rules:**

- Run tests with `-race` flag always — never ship code that hasn't passed the race detector
- Chaos tests run on homelab before any multi-node release
- Every bug that reaches production gets a regression test before the fix is merged
- Integration tests run against all three store backends (SQLite, Postgres, MariaDB) in CI
