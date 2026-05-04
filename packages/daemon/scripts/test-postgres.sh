#!/bin/bash
# Run the Postgres integration tests against a temporary PG container.
# Useful for local development before pushing.
set -euo pipefail

CONTAINER_NAME="rioku-pg-test"

cleanup() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup  # ensure no stale container

echo "Starting Postgres 15..."
docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_USER=rioku \
    -e POSTGRES_PASSWORD=rioku_test \
    -e POSTGRES_DB=rioku_test \
    -p 5432:5432 \
    postgres:15 >/dev/null

echo "Waiting for Postgres to be ready..."
for i in {1..30}; do
    if docker exec "$CONTAINER_NAME" pg_isready -U rioku >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

export POSTGRES_TEST_DSN="postgres://rioku:rioku_test@localhost:5432/rioku_test?sslmode=disable"

echo "Running tests..."
cd "$(dirname "$0")/.."
go test -race -count=1 -v ./internal/store/postgres/...
