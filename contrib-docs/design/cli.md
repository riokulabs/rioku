# Rioku CLI Design Specification

**Version:** 0.2  
**Date:** 2026-04-09  
**Status:** Partially implemented (see inline status markers)  
**Binary:** `rioku` — Short alias: `rku`  
**Modelled on:** AWS CLI conventions

---

## 1. Overview

The Rioku CLI is the primary operator interface for managing the Rioku API and AI gateway. It is modelled directly on the AWS CLI in structure, configuration, and output format conventions.

The CLI communicates with the daemon exclusively over REST (`http://localhost:7778` by default). It never touches the config store directly. All mutations go through the daemon's REST API, giving the daemon full control over validation, audit logging, and config sync.

---

## 2. Configuration & Precedence

Every configurable value follows a strict three-level precedence chain, lowest to highest — the same model as the AWS CLI:

| Priority | Source | Example |
|---|---|---|
| 1 (lowest) | Config file | `~/.config/rioku/config` |
| 2 | Environment variable | `RIOKU_DAEMON_ADDR=https://...` |
| 3 (highest) | Command-line flag | `--daemon-addr https://...` |

### 2.1 Config File

Default location: `~/.config/rioku/config` (XDG-compliant). Override via `RIOKU_CONFIG_FILE`.

Format is INI with named profiles, exactly like `~/.aws/config`. Sensitive values (tokens) live in this single file — unlike AWS's split `config`/`credentials` files, which exist for IAM/SSO reasons that don't apply here. Operators who want tokens out of the file use environment variables instead.

```ini
[default]
daemon_addr = https://localhost:9090
token       = rku_tok_xxxxxxxxxxxxxxxx
output      = table

[profile homelab]
daemon_addr = https://gateway.homelab.internal:9090
token       = rku_tok_yyyyyyyyyyyyyyyy
output      = json

[profile prod]
daemon_addr = https://gateway.prod.internal:9090
token       = rku_tok_zzzzzzzzzzzzzzzz
output      = table
```

### 2.2 Environment Variables

| Variable | CLI Flag | Config Key | Description |
|---|---|---|---|
| `RIOKU_DAEMON_ADDR` | `--daemon-addr` | `daemon_addr` | Daemon address |
| `RIOKU_TOKEN` | `--token` | `token` | Auth token |
| `RIOKU_PROFILE` | `--profile` | — | Active profile name |
| `RIOKU_OUTPUT` | `--output` | `output` | Output format |
| `RIOKU_CONFIG_FILE` | `--config-file` | — | Config file path |
| `RIOKU_NO_COLOR` | `--no-color` | `no_color` | Disable ANSI color |

### 2.3 Global Flags

Inherited by every subcommand. Always override config file and environment variables for the duration of that invocation.

| Flag | Description | Env Override |
|---|---|---|
| `--profile <name>` | Use named profile from config file | `RIOKU_PROFILE` |
| `--daemon-addr <url>` | Daemon address (gRPC/REST) | `RIOKU_DAEMON_ADDR` |
| `--token <token>` | Auth token | `RIOKU_TOKEN` |
| `--output <format>` | `table \| json \| yaml \| text` | `RIOKU_OUTPUT` |
| `--no-color` | Disable color / ANSI output | `RIOKU_NO_COLOR` |
| `--config-file <path>` | Config file path override | `RIOKU_CONFIG_FILE` |
| `--timeout <duration>` | Request timeout (default: 30s) | — |

---

## 3. Output Formats

Set via `--output`, `RIOKU_OUTPUT`, or the `output` key in the config file. Default is `table` when stdout is a TTY.

| Format | Best For | Description |
|---|---|---|
| `table` | Default | Aligned columns, human-readable. Not machine-parseable. |
| `json` | Scripting | Full structured output. Combine with `jq` for filtering. |
| `yaml` | Config-adjacent workflows | Same data as json in YAML syntax. |
| `text` | Unix pipes | Tab-separated, one record per line. For `grep`, `awk`, `cut`. |

No `--query` JMESPath filter. For field filtering, use `jq` or `awk` with `--output json` or `--output text`.

**Streaming operations:** Build progress and install events stream to stderr. The final result record is written to stdout in the configured output format. `rku plugin install ... --output json > result.json` works correctly while still showing live build progress in the terminal.

---

## 4. Exit Codes

| Code | Name | Meaning |
|---|---|---|
| `0` | Success | Command completed successfully. |
| `1` | General error | Unclassified error; see stderr for details. |
| `2` | Usage error | Bad flags, missing required arguments, invalid input. |
| `3` | Daemon unreachable | Could not connect to the daemon at the configured address. |
| `4` | Auth failure | Token invalid, expired, or insufficient permissions. |
| `5` | Not found | Requested resource does not exist. |

Scripts branch on exit code without parsing output.

---

## 5. `rku configure` — NOT YET IMPLEMENTED

Manages the config file and profiles. Mirrors `aws configure` exactly. Never reads from environment variables — operates only on the config file.

```
rku configure                                    # interactive, sets default profile
rku configure --profile <name>                   # interactive, sets named profile
rku configure set <key> <value>                  # set single value, default profile
rku configure set <key> <value> --profile <name> # set single value, named profile
rku configure get <key>                          # print single config value
rku configure list                               # show all values for active profile
rku configure list-profiles                      # show all profile names
```

---

## 6. `rku init`

First-run daemon bootstrap. Generates `rioku.yaml`, initialises the config store, and produces the bootstrap token. Two modes:

**Interactive (default):**
```
$ rku init
Initializing Rioku...
  Store backend [sqlite]:
  Data directory [/var/lib/rioku]:
  Listen address [0.0.0.0:9090]:

✓ Config written to /etc/rioku/rioku.yaml
✓ Bootstrap token: rku_tok_xxxxxxxxxxxxxxxx
  Save this — it will not be shown again.

Run 'rku start' to launch the daemon.
```

**Non-interactive (for automation):**
```bash
rku init \
  --store sqlite \
  --data-dir /var/lib/rioku \
  --listen 0.0.0.0:9090 \
  --non-interactive
```

`--non-interactive` suppresses all prompts. Missing required flags exit `2`. Bootstrap token printed to stdout in both modes.

---

## 7. Full Command Surface

> **Implementation status:** Commands marked ✅ are implemented. Commands marked 🔲 are designed but not yet implemented.

### 7.1 Daemon Lifecycle ✅

```
rku init          # first-run bootstrap
rku start         # start daemon (foreground)
rku stop          # stop daemon
rku status        # daemon, Caddy, store, cluster, and build health
```

### 7.2 `rku route` ✅

```
rku route list
rku route get <id>
rku route create --name <> --match-host <> --match-path <> --service <id>
                 [--match-method <>] [--match-header <>]
rku route update <id> [flags]
rku route delete <id>
rku route enable <id>
rku route disable <id>
```

### 7.3 `rku service` ✅

```
rku service list
rku service get <id>
rku service create --name <> --upstream <addr> [--upstream <addr>] --lb <policy>
                   [--health-check-path <>]
rku service update <id> [flags]
rku service delete <id>
rku service upstream add <service-id> --addr <> [--weight <>] [--tls <>]
rku service upstream remove <service-id> <upstream-id>
```

### 7.4 `rku policy` ✅

```
rku policy list
rku policy get <id>
rku policy create --type <type> --config <json|@file>
rku policy update <id> [flags]
rku policy delete <id>
rku policy attach --route <id> --policy <id>   # or --service <id>
rku policy detach --route <id> --policy <id>
```

### 7.5 `rku key` ✅

```
rku key list
rku key get <id>
rku key create --name <> [--scope <>] [--expires <>]  # token printed once
rku key revoke <id>
rku key rotate <id>   # issues new token, revokes old
```

### 7.6 `rku plugin` 🔲

```
rku plugin list [--type <>] [--status <>]
rku plugin get <id>
rku plugin install <module-path> [--config <json|@file>] [--defer-build]
rku plugin remove <id> [--purge-config] [--defer-build]
rku plugin config get <plugin-id>
rku plugin config set <plugin-id> --config <json|@file> [--merge]
```

### 7.7 `rku build` 🔲

```
rku build status
rku build logs [--follow]
rku build history
```

### 7.8 `rku cluster` 🔲

```
rku cluster list
rku cluster get <node-id>
rku cluster remove <node-id>
```

### 7.9 `rku config` ✅

Gateway config snapshot management. Not to be confused with `rku configure` (CLI config file).

```
rku config export [--output-file <>]
rku config import --file <>
rku config versions   # list snapshots available for rollback
```

### 7.10 `rku migrate` ✅

Store backend migration. SQLite → Postgres or MariaDB. No manual intervention required beyond config changes.

```
rku migrate verify --to <backend> --dsn <>   # dry-run, no writes
rku migrate run    --to <backend> --dsn <>
rku migrate status
```

### 7.11 `rku audit` ✅

```
rku audit list [--limit <>] [--since <>] [--actor <>] [--resource <>]
```

---

## 8. Design Conventions

### 8.1 `--config <json|@file>`

When a flag accepts structured data (policy config, plugin config), it accepts either an inline JSON string or a `@path/to/file.json` reference:

```bash
# Inline
rku policy create --type rate-limit --config '{"requests":100,"window":"1m"}'

# File reference
rku policy create --type rate-limit --config @./rate-limit.json
```

### 8.2 `create` Returns the Created Resource

Every `create` command returns the created resource in the configured output format. ID extraction is scriptable without parsing human-readable output:

```bash
ROUTE_ID=$(rku route create \
  --name payments-api \
  --match-path /payments \
  --service svc-abc \
  --output json | jq -r .id)

rku policy attach --route $ROUTE_ID --policy pol-xyz
```

### 8.3 Streaming to stderr, Result to stdout

Long-running operations (`plugin install`, `build`) stream progress to stderr and write the final result record to stdout:

```bash
# Build progress visible in terminal; final JSON captured in file
rku plugin install github.com/org/my-plugin --output json > install-result.json
```
