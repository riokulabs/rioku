# sandbox/Dockerfile.app — Generic multi-stage build for sandbox upstream apps.
# Each app is a standalone Go module with no external dependencies.
#
# Usage: build via compose.yaml with APP_NAME build arg.

FROM golang:1.24-bookworm AS builder
ARG APP_NAME
WORKDIR /src
COPY sandbox/apps/${APP_NAME}/ ./
RUN CGO_ENABLED=0 go build -o /app .

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app /app
ENTRYPOINT ["/app"]
