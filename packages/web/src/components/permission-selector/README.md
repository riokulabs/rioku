# `<PermissionSelector>`

Multi-select permission picker backed by the full Rioku permission catalog.

## Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `value` | `string[]` | required | Selected permission keys |
| `onChange` | `(v: string[]) => void` | required | Called with new selection |
| `label` | `string` | — | Optional field label |
| `excludePermissions` | `string[]` | `[]` | Permission keys to hide (useful for role-editor parent exclusion) |

## Behaviour

- Sources permissions from the mock store via `usePermissionsCatalog()` hook
- Groups by namespace: "Built-in" first, then each plugin's reverse-DNS prefix
- Plugin-dynamic permissions render with a "dynamic" badge
- Searchable via Mantine's built-in MultiSelect search
- Selected values render as removable pills inside the input field

## Architecture note

The component must not import from `api/` directly (components/ boundary). It accesses the permission catalog through `src/hooks/use-permissions-catalog.ts`, which is the proper mediating layer.
