# Makefile targets

Run `make` with no arguments (or `make help`) to see all available targets grouped by category.

## Categories

| Category  | Description                                              |
|-----------|----------------------------------------------------------|
| `sandbox` | Local sandbox environment, load tests, container helpers |
| `build`   | Compile binaries, proto codegen, web embed               |
| `test`    | Unit, race, security, E2E, coverage, benchmarks          |
| `lint`    | Go linters, commit message, spell check                  |
| `proto`   | Proto generation, linting, OpenAPI merge                 |
| `web`     | Admin SPA build, dev server, type generation, docs       |
| `dev`     | Setup, hooks, worktrees, utilities                       |
| `release` | Reserved for CI release targets                          |

## Common workflows

```sh
# First-time setup
make setup

# Start the sandbox and iterate
make sandbox
make sandbox-restart-daemon-fast   # after Go changes
make sandbox-test-smoke            # quick validation

# Build without sandbox
make build-daemon                  # full build (embeds web)
make build-daemon-fast             # incremental (skips web if unchanged)

# Run tests
make test-fast                     # local iteration (race, -short)
make test-race                     # full suite (CI equivalent)
make proto-lint                    # lint proto definitions
```

## Target rename map

These old names were removed. Use the canonical names below.

| Old name              | Canonical name                 |
|-----------------------|--------------------------------|
| `start`               | `sandbox`                      |
| `stop`                | `sandbox-stop`                 |
| `seed`                | `sandbox-seed`                 |
| `restart-daemon`      | `sandbox-restart-daemon`       |
| `restart-daemon-fast` | `sandbox-restart-daemon-fast`  |

Deprecation shims remain in the Makefile and will print a warning, then delegate
to the canonical target. They will be removed in a future release.

## Adding a new target

1. Add the target name to the `.PHONY` line at the top of the Makefile.
2. Prefix the comment with the category and a pipe separator:

   ```makefile
   ## <category> | <target-name>: Short description
   ```

3. The `make help` output updates automatically — no other changes needed.
