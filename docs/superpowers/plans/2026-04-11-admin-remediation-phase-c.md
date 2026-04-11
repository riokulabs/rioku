# Admin Panel Remediation -- Phase C: Security/RBAC Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the Security/RBAC section of the admin panel by replacing all "coming soon" placeholders with working UI backed by MSW mock data: effective permissions panel on user detail, access policies CRUD, role editing with permission rules + save, user sessions management, enhanced API key creation, and API key usage/activity tabs.

**Architecture:** All new data comes from MSW mock handlers added in Phase A. New components integrate existing `EffectivePermissionsPanel`, `PermissionRuleEditor`, `ConditionEditor`, and `ActivityTimeline` components. Access policies get a full CRUD flow using `DataTable` on the list page and inline editing on the detail page. API key creation is enhanced with description, expiry, and scope fields. Session management uses mock session data from the auth handler.

**Tech Stack:** React 19, TypeScript 6, TanStack Router + Query, MSW 2.x, Vitest 4.x, @testing-library/react, happy-dom

**Working directory:** `.worktrees/admin-remediation-c/packages/web/`

**Depends on:** Phases A and B must be complete. The following must exist:
- MSW handlers for auth endpoints (`src/mocks/handlers/auth.ts`) with session data
- MSW handlers for keys (`src/mocks/handlers/keys.ts`)
- `EffectivePermissionsPanel` component in `src/components/rioku/effective-permissions.tsx`
- `PermissionRuleEditor` component in `src/components/rioku/permission-rule-editor.tsx`
- `ConditionEditor` component in `src/components/rioku/condition-editor.tsx`
- `ActivityTimeline` component in `src/components/rioku/activity-timeline.tsx`
- `StatCard` component in `src/components/rioku/stat-card.tsx`
- `DataTable` component in `src/components/rioku/data-table.tsx`
- Mock data: `src/mocks/data/users.ts`, `src/mocks/data/api-keys.ts`
- API types: `AccessPolicy`, `AccessCondition`, `PermissionRule`, `ExpandedRole`, `ApiKey` in `src/lib/api.ts`
- `computeEffectivePermissions` in `src/lib/permissions.ts`

**Key conventions:**
- Conventional Commits required (`feat:`, `fix:`, etc.)
- No AI tool references in commits
- TDD where practical
- Vitest + @testing-library/react + happy-dom for testing
- Use `source ~/.nvm/nvm.sh &&` before any node/npx commands
- Button uses `render` prop pattern, NOT `asChild`

---

## Task 1: Mock Data & Handlers for Access Policies and User Sessions (C1, C2, C4)

**Why first:** All subsequent tasks depend on MSW returning access policies, expanded roles with permission rules, and per-user session data.

**Files:**
- Create: `src/mocks/data/access-policies.ts`
- Create: `src/mocks/data/sessions.ts`
- Modify: `src/mocks/handlers/auth.ts` (add access policies, per-user sessions, expanded role endpoints)
- Modify: `src/mocks/data/users.ts` (add `mockExpandedRoles` with rules)

- [ ] **Step 1: Create mock access policies data**

File: `src/mocks/data/access-policies.ts`

8 realistic access policies covering various condition types (IP, time, MFA, geo), targeting both roles and users, with different effects and priorities.

- [ ] **Step 2: Create mock sessions data**

File: `src/mocks/data/sessions.ts`

Per-user session arrays. Each session has: id, device, ip, location, lastActive, current flag, userAgent, createdAt.

- [ ] **Step 3: Add expanded roles with permission rules to mock data**

Modify: `src/mocks/data/users.ts`

Export `mockExpandedRoles` array: each role gets `parentRoleIds`, `childRoleIds`, `rules` (PermissionRule[]) with realistic resource/action/scope/effect combinations. Admin gets wildcard, operator gets config + traffic, viewer gets read-only.

- [ ] **Step 4: Add MSW handlers for access policies CRUD**

Modify: `src/mocks/handlers/auth.ts`

Add handlers:
- `GET /api/v1/auth/access-policies` -> return all policies
- `POST /api/v1/auth/access-policies` -> create new, return with generated id
- `GET /api/v1/auth/access-policies/:id` -> return single policy
- `PUT /api/v1/auth/access-policies/:id` -> update in-place
- `DELETE /api/v1/auth/access-policies/:id` -> remove from array
- `GET /api/v1/auth/users/:userId/sessions` -> return per-user sessions
- `DELETE /api/v1/auth/users/:userId/sessions/:sessionId` -> terminate session
- `DELETE /api/v1/auth/users/:userId/sessions` -> terminate all non-current
- `GET /api/v1/auth/users/:userId/effective-permissions` -> compute and return permissions

- [ ] **Step 5: Verify tsc compiles**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```
feat: add MSW mock data and handlers for access policies and user sessions
```

---

## Task 2: Effective Permissions Panel on User Detail (C1)

**Files:**
- Modify: `src/routes/security/users.$userId.tsx` (add EffectivePermissionsPanel below roles card)
- Modify: `src/routes/security/__tests__/user-detail.test.tsx` (add tests for permissions panel)

- [ ] **Step 1: Wire EffectivePermissionsPanel into user detail page**

Import `EffectivePermissionsPanel` and `useQuery`. In the loader, also fetch expanded roles and access policies. Add the panel below the roles card, passing `assignedRoles` (filtered from expanded roles by user's role names), `allRoles`, and `accessPolicies`.

- [ ] **Step 2: Update tests**

Add test: "renders effective permissions panel". Mock the `EffectivePermissionsPanel` component and verify it appears.

- [ ] **Step 3: Verify tsc + tests pass**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit && npx vitest run src/routes/security/__tests__/user-detail.test.tsx
```

- [ ] **Step 4: Commit**

```
feat: add effective permissions panel to user detail view
```

---

## Task 3: Access Policies List Page with DataTable (C2)

**Files:**
- Modify: `src/routes/security/access-policies.index.tsx` (replace EmptyState with DataTable)
- Modify: `src/routes/security/__tests__/access-policies.test.tsx` (update tests)

- [ ] **Step 1: Replace EmptyState with full list page**

Add loader that fetches access policies via `apiClient.get<AccessPolicy[]>('/auth/access-policies')`. Replace `EmptyState` with `DataTable` showing columns: Name (link to detail), Effect (badge), Target Type, Targets (badges), Conditions count, Priority, Enabled (badge). Keep the "Create" button. Add empty state within DataTable for zero results.

- [ ] **Step 2: Update tests**

Test: renders page title, renders DataTable with columns, shows create button.

- [ ] **Step 3: Verify tsc + tests pass**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit && npx vitest run src/routes/security/__tests__/access-policies.test.tsx
```

- [ ] **Step 4: Commit**

```
feat: replace access policies empty state with DataTable list
```

---

## Task 4: Access Policy Detail Page (C2)

**Files:**
- Create: `src/routes/security/access-policies.$policyId.tsx`
- Modify: `src/routes/security/__tests__/access-policies.test.tsx` (add detail tests)

- [ ] **Step 1: Create access policy detail page**

Route: `/security/access-policies/$policyId`. Loader fetches all policies and finds by id. Show:
- Back link, heading with policy name
- Details card: name (editable), description (editable), effect selector, priority input, enabled switch
- Targets card: target type selector (roles/users), target ids as tag input
- Conditions card: ConditionEditor component
- Save button (mutation to PUT endpoint)
- Danger zone: delete button with ConfirmDialog

- [ ] **Step 2: Add tests for detail page**

Tests: renders policy name, renders edit fields, renders condition editor, renders delete button.

- [ ] **Step 3: Verify tsc + tests pass**

- [ ] **Step 4: Commit**

```
feat: add access policy detail page with inline editing
```

---

## Task 5: Access Policy Create Page Enhancement (C2)

**Files:**
- Modify: `src/routes/security/access-policies.create.tsx` (wire up mutation, add target fields)
- Modify: `src/routes/security/__tests__/access-policies.test.tsx` (update create tests)

- [ ] **Step 1: Enhance create page**

Add target type selector (roles/users), target IDs via TagInput, priority input. Wire the create button to a mutation that POSTs to `/auth/access-policies` and navigates to the new policy detail page on success. Remove the "preview only" disclaimer.

- [ ] **Step 2: Update tests**

Test: renders target type selector, create button is enabled when form is valid.

- [ ] **Step 3: Verify tsc + tests pass**

- [ ] **Step 4: Commit**

```
feat: wire access policy create page with mutation and target fields
```

---

## Task 6: Role Editing with Permission Rules + Save (C3)

**Files:**
- Modify: `src/routes/security/roles.$roleId.tsx` (add save mutation for permission rules)
- Modify: `src/routes/security/__tests__/role-detail.test.tsx` (add save button test)

- [ ] **Step 1: Add save mutation for permission rules**

Add a "Save changes" button below the PermissionRuleEditor that triggers a PUT mutation to `/auth/roles/:roleId`. Track dirty state (rules !== original rules). Show unsaved changes indicator. Disable save when rules match original. Add toast on success/error.

- [ ] **Step 2: Update tests**

Test: renders save button for non-builtin roles, save button disabled when no changes.

- [ ] **Step 3: Verify tsc + tests pass**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit && npx vitest run src/routes/security/__tests__/role-detail.test.tsx
```

- [ ] **Step 4: Commit**

```
feat: add save mutation for role permission rules
```

---

## Task 7: User Sessions Management (C4)

**Files:**
- Modify: `src/routes/security/users.$userId.tsx` (replace "coming soon" with sessions table)
- Modify: `src/routes/security/__tests__/user-detail.test.tsx` (add session tests)

- [ ] **Step 1: Add sessions table to user detail security card**

Replace the "Session management coming soon" text with a sessions table fetched via `useQuery` from `/auth/users/:userId/sessions`. Table columns: Device, IP, Location, Last Active, Actions (terminate button). Add "Terminate all other sessions" button above the table. Wire terminate mutations.

- [ ] **Step 2: Update tests**

Tests: renders sessions table header, renders terminate button.

- [ ] **Step 3: Verify tsc + tests pass**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit && npx vitest run src/routes/security/__tests__/user-detail.test.tsx
```

- [ ] **Step 4: Commit**

```
feat: add user sessions management to user detail page
```

---

## Task 8: API Key Create Enhancement (C5)

**Files:**
- Modify: `src/routes/security/api-keys.index.tsx` (enhance create dialog)
- Modify: `src/mocks/handlers/keys.ts` (handle description, expiry, scopes in create)

- [ ] **Step 1: Enhance create dialog**

Add to the create dialog:
- Description textarea field
- Expiry selector: 30d, 60d, 90d, 1y, Never (as a Select)
- Scope selection via a multi-select with checkboxes for common scopes
- One-time key display with warning banner (already exists, keep as-is)

Update the mutation payload to include description, expiresAt (computed from expiry selection), scopes.

- [ ] **Step 2: Update MSW keys handler**

Accept `description`, `expiresAt`, `scopes` fields in POST handler. Store them in the created key.

- [ ] **Step 3: Verify tsc + tests pass**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```
feat: enhance API key creation with description, expiry, and scope selection
```

---

## Task 9: API Key Usage & Activity Tabs (C6)

**Files:**
- Modify: `src/routes/security/api-keys.$keyId.tsx` (replace coming soon in usage/activity tabs)
- Modify: `src/mocks/handlers/keys.ts` (add usage and activity endpoints)
- Create: `src/mocks/data/api-key-activity.ts` (mock activity data)
- Modify: `src/routes/security/__tests__/api-key-detail.test.tsx` (update tests)

- [ ] **Step 1: Create mock API key activity data**

File: `src/mocks/data/api-key-activity.ts`

Per-key usage stats (24h/7d/30d request counts, last used timestamp) and activity entries (created, scope changed, rotated events with timestamps and actors).

- [ ] **Step 2: Add MSW handlers for key usage and activity**

Modify: `src/mocks/handlers/keys.ts`

- `GET /api/v1/keys/:id/usage` -> return usage stats
- `GET /api/v1/keys/:id/activity` -> return activity entries

- [ ] **Step 3: Replace usage tab placeholder**

Show StatCards for request counts (24h, 7d, 30d) with icons. Show "Last used" timestamp. All data fetched via useQuery from the usage endpoint.

- [ ] **Step 4: Replace activity tab placeholder**

Use `ActivityTimeline` component with data fetched from the activity endpoint. Each entry shows action, actor, timestamp, detail.

- [ ] **Step 5: Update tests**

Tests: usage tab renders stat cards (mocked), activity tab renders timeline.

- [ ] **Step 6: Verify tsc + tests pass**

```bash
source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit && npx vitest run src/routes/security/__tests__/api-key-detail.test.tsx
```

- [ ] **Step 7: Commit**

```
feat: add API key usage stats and activity timeline tabs
```

---

## Verification

- [ ] **Full test suite passes**: `source ~/.nvm/nvm.sh && cd packages/web && npx vitest run`
- [ ] **TypeScript compiles**: `source ~/.nvm/nvm.sh && cd packages/web && npx tsc --noEmit`
- [ ] **No regressions**: All existing security page tests still pass
