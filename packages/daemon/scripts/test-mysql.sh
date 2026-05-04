#!/bin/bash
# Run the MySQL integration tests against a temporary container.
set -euo pipefail

CONTAINER_NAME="rioku-mysql-test"
IMAGE="${MYSQL_IMAGE:-mysql:8.4}"

cleanup() {
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

cleanup

echo "Starting $IMAGE..."
if [[ "$IMAGE" == mariadb:* ]]; then
    docker run -d \
        --name "$CONTAINER_NAME" \
        -e MARIADB_USER=rioku \
        -e MARIADB_PASSWORD=rioku_test \
        -e MARIADB_DATABASE=rioku_test \
        -e MARIADB_ROOT_PASSWORD=rioku_root \
        -p 3306:3306 \
        "$IMAGE" >/dev/null
    PING_CMD="mariadb-admin ping -h localhost -u root -prioku_root"
else
    docker run -d \
        --name "$CONTAINER_NAME" \
        -e MYSQL_USER=rioku \
        -e MYSQL_PASSWORD=rioku_test \
        -e MYSQL_DATABASE=rioku_test \
        -e MYSQL_ROOT_PASSWORD=rioku_root \
        -p 3306:3306 \
        "$IMAGE" >/dev/null
    PING_CMD="mysqladmin ping -h localhost -u root -prioku_root"
fi

echo "Waiting for $IMAGE to be ready..."
for i in {1..60}; do
    if docker exec "$CONTAINER_NAME" $PING_CMD >/dev/null 2>&1; then
        break
    fi
    sleep 1
done

export MYSQL_TEST_DSN="rioku:rioku_test@tcp(localhost:3306)/rioku_test?parseTime=true&loc=UTC&multiStatements=false"

echo "Running tests against $IMAGE..."
cd "$(dirname "$0")/.."
go test -race -count=1 -v ./internal/store/mysql/...
