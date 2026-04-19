# `<PermissionPathTrace>`

Effective-permission path viewer — shows WHY a user has (or does not have) a specific permission on a specific tenant.

## Props

| Prop | Type | Description |
|---|---|---|
| `userId` | `string` | The user to inspect |
| `tenantId` | `string` | The tenant context |
| `permission` | `string` | The permission key to trace (e.g. `service:read`) |

## Outcomes

| Outcome | Display |
|---|---|
| `granted` | Green check + role chain path + optional CEL condition tooltip |
| `denied` | Red X + which role carries the explicit deny entry |
| `no-source` | Grey dash + "No role grants this permission" |

## Resolution

Uses `usePermissionTrace()` hook (in `src/hooks/`) which:
1. Finds the user's membership for the tenant
2. Calls `resolveRolePermissions()` from `src/host/role-resolver.ts` on the membership's role_ids
3. Detects explicit denies by walking role ancestors
4. Returns a structured trace result with the full role path

## Architecture note

The component imports from `hooks/` only — the mock store access is mediated by `src/hooks/use-permission-trace.ts` to respect the `components/` → `api/` boundary.
