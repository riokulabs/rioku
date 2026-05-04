# Store Test Matrix

Rioku's storage layer is implemented for three database backends:
SQLite (default), PostgreSQL, and MySQL/MariaDB. The integration test
suite is gated by environment variables so contributors without all
three databases installed can still run the parts they care about.

## Environment Variables

| Var | Format | Used by |
|---|---|---|
| `POSTGRES_TEST_DSN` | `postgres://user:pass@host:port/db?sslmode=disable` | `internal/store/postgres/...` integration tests |
| `MYSQL_TEST_DSN` | `user:pass@tcp(host:port)/db?parseTime=true&loc=UTC&multiStatements=true` | `internal/store/mysql/...` integration tests |
| `GALERA_TEST_DSNS` | comma-separated list of MySQL DSNs | `internal/store/mysql/galera_test.go` only |

When an env var is unset, the corresponding tests skip cleanly via `t.Skip(...)`.
SQLite tests have no env var — they always run via in-memory DBs.

## Running Locally

### Convenience scripts

```bash
# Postgres (single-node Docker container)
packages/daemon/scripts/test-postgres.sh

# MySQL 8.4 (single-node Docker container)
packages/daemon/scripts/test-mysql.sh

# Different MySQL/MariaDB image
MYSQL_IMAGE=mariadb:11.4 packages/daemon/scripts/test-mysql.sh
```

### Manual

```bash
# Postgres
docker run -d --name rioku-pg \
    -e POSTGRES_USER=rioku -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rioku_test \
    -p 5432:5432 postgres:15
sleep 3
POSTGRES_TEST_DSN="postgres://rioku:test@localhost:5432/rioku_test?sslmode=disable" \
    go test ./packages/daemon/internal/store/postgres/...

# MySQL
docker run -d --name rioku-mysql \
    -e MYSQL_USER=rioku -e MYSQL_PASSWORD=test -e MYSQL_DATABASE=rioku_test \
    -e MYSQL_ROOT_PASSWORD=test \
    -p 3306:3306 mysql:8.4
sleep 30  # mysql:8.4 takes longer to initialize
MYSQL_TEST_DSN="rioku:test@tcp(localhost:3306)/rioku_test?parseTime=true&loc=UTC&multiStatements=true" \
    go test ./packages/daemon/internal/store/mysql/...
```

## CI Job Names

Branch protection rules should require all five required jobs:

- `store-matrix-sqlite`
- `store-matrix-postgres-15`
- `store-matrix-postgres-18`
- `store-matrix-mysql-8-4`
- `store-matrix-mariadb-11-4`

The following job is optional (early signal only; do NOT mark required):

- `store-matrix-mariadb-11-8 (optional)` — MariaDB 11.8 is not LTS

Job names are stable hyphenated identifiers defined as job keys in
`.github/workflows/store-matrix.yml`. GitHub branch protection uses the
job key, not the `name:` field — both are kept identical here to avoid
confusion. Do not rename these jobs without updating branch protection rules.

## Database Version Floors

| Backend | Minimum supported | EOL of minimum | Rationale |
|---|---|---|---|
| SQLite | 3.40 | (built-in) | Used in tests; bundled with Go's mattn/go-sqlite3 |
| PostgreSQL | 15 | November 2027 | PG 14 EOL November 2026 — supporting it would force a floor bump inside any v1 LTS window |
| MySQL | 8.4 LTS | April 2032 | MySQL 8.0 EOL April 2026 |
| MariaDB | 11.4 LTS | May 2029 | 11.4 is the active LTS line |
