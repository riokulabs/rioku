# `<ErrorState>`

Renders a prominent error placeholder when a page section or data load has failed.

## What it is for

- Failed API fetches that prevent the section from rendering
- Unexpected runtime errors within a React error boundary's fallback
- Any scenario where the user needs to know something went wrong and optionally retry

## What it is NOT for

- Empty data (use `<EmptyState>`)
- In-flight loading (use `<LoadingState>`)
- Inline form field validation errors

## Correlation ID

When `correlationId` is provided, it is rendered via `<IdBadge>` which lets the
user click to copy the ID for support tickets.

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `title` | `string` | `'Something went wrong'` | Error headline |
| `description` | `string` | — | Human-readable detail |
| `correlationId` | `string` | — | Server correlation ID (click-to-copy) |
| `retry` | `() => void` | — | Renders "Try again" button when provided |
