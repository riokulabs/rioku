# `<EmptyState>`

Renders a centered, icon-based placeholder when a list or data surface has no content.

## What it is for

- Table / list pages with zero rows after load
- Search results that return nothing
- Optional "Create first item" call-to-action via the `action` prop

## What it is NOT for

- Full-page errors (use `<ErrorState>`)
- In-flight loading (use `<LoadingState>`)
- Inline field or form validation messages

## Props

| Prop | Type | Required | Description |
|---|---|---|---|
| `icon` | `Icon` (Tabler) | yes | Decorative icon displayed in a `ThemeIcon` |
| `title` | `string` | yes | Short headline |
| `description` | `string` | no | Supporting text |
| `action.label` | `string` | no | CTA button label |
| `action.onClick` | `() => void` | no | CTA handler |
