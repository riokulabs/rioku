# `<DiffView>`

Side-by-side JSON diff component. Uses a built-in recursive differ (no external dep).

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `before` | `unknown` | required | Value before the change |
| `after` | `unknown` | required | Value after the change |
| `label` | `string` | `'Changes'` | Header label |
| `format` | `'json' \| 'auto'` | `'auto'` | Parsing hint |
| `compact` | `boolean` | `false` | Hide unchanged keys |

## Diff rules

- **Unchanged** — shown in both columns, muted
- **Changed** — red background left, green background right
- **Added** (key only in `after`) — "—" on left, green value on right
- **Removed** (key only in `before`) — red value on left, "—" on right
- **Nested objects** — recursed one level at a time (indented tree)

## Usage

```tsx
import { DiffView } from '@/components/diff-view';

<DiffView
  before={entry.diff.before}
  after={entry.diff.after}
  label="Membership role update"
  compact
/>
```
