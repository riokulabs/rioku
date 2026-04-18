# `<SystemBanner>`

A full-width alert banner for system-level notifications displayed at the top of a page or layout section.

## What it is

- Wraps Mantine `<Alert>` with four semantic tone variants: `info`, `warning`, `critical`, `success`.
- Each tone maps to a Mantine color (`blue`, `yellow`, `red`, `green`).
- Supports an optional close button via `dismissible + onDismiss`.
- Supports an optional primary action button at the right edge via `action: { label, onClick }`.
- Suitable for: maintenance windows, deprecation notices, connectivity warnings, success confirmations.

## What it is not for

- It is not for inline form-field validation errors — use Mantine `<TextInput error>` for that.
- It is not for transient toasts / snackbars — use `@mantine/notifications` for those.
- It is not a page-level empty state — use a dedicated empty-state component for zero-data screens.
- Do not nest `<SystemBanner>` inside another `<SystemBanner>`.
