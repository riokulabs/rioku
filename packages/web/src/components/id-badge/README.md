# `<IdBadge>`

A small inline component that displays a truncated resource ID with a click-to-copy button.

## What it is

- Renders the first 6 characters, an ellipsis (`…`), and the last 4 characters of an `id` string (e.g. `abcdef…7890`).
- Accepts an optional `label` override to display a human-readable name instead of the truncated ID while still copying the full ID.
- Wraps Mantine `<CopyButton>` + `<Tooltip>` to provide copy-on-click UX with "Copied" confirmation.
- Uses `<ActionIcon aria-label="Copy ID">` with `IconCopy` / `IconCheck` icons.

## What it is not for

- It is not a full UUID display — use a plain `<Code>` or `<Text ff="monospace">` for that.
- It is not a navigation link — do not use it where a clickable ID should route somewhere.
- It does not validate or parse the `id` — any non-empty string is accepted.
- Do not use it for secrets (API keys, tokens) — use the dedicated secret-reveal component for those.
