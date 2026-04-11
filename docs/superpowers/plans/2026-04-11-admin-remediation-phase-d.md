# Admin Panel Remediation -- Phase D: Quality of Life

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add six quality-of-life improvements to the admin panel: entity search in the command palette, session timeout warning modal, auto-save drafts on create pages, inline form validation, optimistic updates for toggle/delete, and stale data indicators with recently viewed entities.

**Architecture:** All features are client-side only. Entity search queries MSW-backed endpoints (`/config`, `/auth/users`, `/keys`). Session timeout reads from the existing `useSession` hook's `expiresAt`. Auto-save uses localStorage with periodic timers. Inline validation extends Zod schemas already used in create pages. Optimistic updates leverage TanStack Query's `onMutate`/`onError`/`onSettled` pattern. Recently viewed uses localStorage.

**Tech Stack:** React 19, TypeScript 6, TanStack Router + Query, Vitest 4.x, @testing-library/react, happy-dom

**Working directory:** `.worktrees/admin-remediation-d/packages/web/`

**Depends on:** Phases A, B, and C must be complete. The following must exist:
- MSW handlers for config (`src/mocks/handlers/config.ts`) with routes, services, policies
- MSW handlers for auth (`src/mocks/handlers/auth.ts`) with users, sessions
- MSW handlers for keys (`src/mocks/handlers/keys.ts`) with API keys
- Mock data: routes, services, policies, users, API keys
- `CommandPalette` component in `src/components/layout/command-palette.tsx`
- `useSession` hook in `src/hooks/use-auth.ts`
- Zod schemas in `src/lib/schemas/route.ts`, `src/lib/schemas/service.ts`, `src/lib/schemas/policy-schemas.ts`
- `useRouteMutations` in `src/hooks/use-config-mutations.ts`
- Route list page at `src/routes/config/routes.index.tsx`
- Create pages: `routes.create.tsx`, `services.create.tsx`, `policies.create.tsx`

**Key conventions:**
- Conventional Commits required (`feat:`, `fix:`, etc.)
- No AI tool references in commits
- TDD where practical
- Vitest + @testing-library/react + happy-dom for testing
- Use `source ~/.nvm/nvm.sh &&` before any node/npx commands
- Button uses `render` prop pattern, NOT `asChild`

---

## Task 1: Command Palette Entity Search (D1)

**Why first:** Highest user-visible impact -- makes navigation instant. No dependencies on other Phase D tasks.

**Files:**
- Create: `src/hooks/use-entity-search.ts`
- Create: `src/hooks/__tests__/use-entity-search.test.ts`
- Modify: `src/components/layout/command-palette.tsx`
- Create: `src/components/layout/__tests__/command-palette-search.test.tsx`
- Modify: `src/mocks/handlers/config.ts` (add search endpoint)

- [ ] **Step 1: Create `useEntitySearch` hook**

File: `src/hooks/use-entity-search.ts`

Hook that accepts a search query string and returns categorized results from all entity types. Uses TanStack Query to fetch from:
- `/config` (routes, services, policies)
- `/auth/users` (users)
- `/keys` (API keys)

Results are filtered client-side by matching query against: route name + hosts, service name, policy name + type, user username + email + displayName, API key name + prefix.

Returns `{ results: EntitySearchResult[], isLoading: boolean }` where each result has `{ type, id, name, subtitle, path }`.

- [ ] **Step 2: Create `useRecentlyViewed` hook**

File: `src/hooks/use-recently-viewed.ts`

Hook that manages a localStorage list of recently viewed entities (max 10). Provides:
- `recentItems: RecentItem[]` (type, id, name, path, viewedAt)
- `addRecent(item)` -- deduplicates by id, pushes to front
- `clearRecent()`

Key: `rioku-recently-viewed`

- [ ] **Step 3: Write tests for `useEntitySearch`**

File: `src/hooks/__tests__/use-entity-search.test.ts`

Test cases:
- Returns empty results for empty query
- Filters routes by name
- Filters services by name
- Filters policies by name and type
- Filters users by username and email
- Filters API keys by name and prefix
- Returns results from multiple entity types
- Limits results to 5 per category

- [ ] **Step 4: Write tests for `useRecentlyViewed`**

File: `src/hooks/__tests__/use-recently-viewed.test.ts`

Test cases:
- Returns empty array when no items stored
- Adds and retrieves items
- Deduplicates by id (moves to front)
- Limits to 10 items
- clearRecent empties the list

- [ ] **Step 5: Update `CommandPalette` with entity search**

Modify: `src/components/layout/command-palette.tsx`

Changes:
1. Import and use `useEntitySearch` with the current command input value
2. Import and use `useRecentlyViewed`
3. Add a "Recent" `CommandGroup` at the top (when query is empty and recent items exist)
4. Add entity result groups after navigation groups: "Routes", "Services", "Policies", "Users", "API Keys"
5. Each entity item navigates to its detail page on select and adds to recently viewed
6. Show entity type icons: `RouteIcon`, `ServerIcon`, `ShieldIcon`, `UserIcon`, `KeyIcon`
7. Subtitle text under each item (e.g., host for routes, type for policies)

- [ ] **Step 6: Verify tsc compiles**

---

## Task 2: Session Timeout Warning (D2)

**Why:** Prevents data loss from unexpected session expiry. Self-contained, no dependencies on other Phase D tasks.

**Files:**
- Create: `src/hooks/use-session-timeout.ts`
- Create: `src/hooks/__tests__/use-session-timeout.test.ts`
- Create: `src/components/layout/session-timeout-dialog.tsx`
- Create: `src/components/layout/__tests__/session-timeout-dialog.test.tsx`
- Modify: `src/routes/__root.tsx` (mount the dialog)

- [ ] **Step 1: Create `useSessionTimeout` hook**

File: `src/hooks/use-session-timeout.ts`

Hook that reads session expiry from `useSession` (`data.session.expiresAt`) and manages a countdown:
- `timeRemaining: number` (seconds until expiry)
- `showWarning: boolean` (true when <= 300 seconds remain)
- `isExpired: boolean` (true when <= 0)
- `extendSession()` -- calls `POST /api/v1/auth/refresh` and invalidates session query
- Internal `setInterval` every 1s to decrement countdown
- On `isExpired`, navigate to `/login`

- [ ] **Step 2: Write tests for `useSessionTimeout`**

File: `src/hooks/__tests__/use-session-timeout.test.ts`

Test cases:
- Returns correct time remaining
- showWarning is false when > 5 min remain
- showWarning is true when <= 5 min remain
- isExpired is true when time is 0
- extendSession triggers API call

- [ ] **Step 3: Create `SessionTimeoutDialog` component**

File: `src/components/layout/session-timeout-dialog.tsx`

Dialog that shows when `showWarning` is true:
- Title: "Session Expiring"
- Body: "Your session will expire in {mm:ss}. Extend your session to continue working."
- Countdown text updates every second
- "Extend Session" button calls `extendSession()`
- "Log Out" button navigates to `/login`
- Dialog closes on extend success

- [ ] **Step 4: Write tests for `SessionTimeoutDialog`**

File: `src/components/layout/__tests__/session-timeout-dialog.test.tsx`

Test cases:
- Renders when showWarning is true
- Does not render when showWarning is false
- Displays countdown timer
- Extend button calls extendSession
- Log Out button present

- [ ] **Step 5: Mount in root layout**

Add MSW handler for `POST /api/v1/auth/refresh` in `src/mocks/handlers/auth.ts` (returns updated session with extended expiry).

Mount `<SessionTimeoutDialog />` in `src/routes/__root.tsx`.

- [ ] **Step 6: Verify tsc compiles**

---

## Task 3: Auto-Save Drafts (D3)

**Why:** Prevents data loss during form entry. Self-contained, uses localStorage only.

**Files:**
- Create: `src/hooks/use-draft.ts`
- Create: `src/hooks/__tests__/use-draft.test.ts`
- Modify: `src/routes/config/routes.create.tsx`
- Modify: `src/routes/config/services.create.tsx`
- Modify: `src/routes/config/policies.create.tsx`

- [ ] **Step 1: Create `useDraft` hook**

File: `src/hooks/use-draft.ts`

Generic hook: `useDraft<T>(entityType: string, formValues: T, setFormValues: (v: T) => void)`

Behavior:
- Key: `rioku-draft:{entityType}`
- On mount, check for existing draft. If found, set `hasDraft: true`, store `draftTimestamp`.
- `restoreDraft()` -- parse stored draft, call `setFormValues`
- `discardDraft()` -- remove from localStorage
- Auto-save: `useEffect` with 30-second `setInterval` that writes `{ values: formValues, timestamp: Date.now() }` to localStorage (only if formValues differ from initial)
- `clearDraft()` -- called after successful save
- Returns `{ hasDraft, draftTimestamp, restoreDraft, discardDraft, clearDraft }`

- [ ] **Step 2: Write tests for `useDraft`**

File: `src/hooks/__tests__/use-draft.test.ts`

Test cases:
- Returns hasDraft=false when no draft exists
- Auto-saves after interval
- restoreDraft loads saved values
- discardDraft removes from localStorage
- clearDraft removes from localStorage
- hasDraft=true when draft exists on mount

- [ ] **Step 3: Add draft restore banner component**

File: `src/components/rioku/draft-banner.tsx`

A small banner shown at the top of create pages when a draft exists:
- "You have an unsaved draft from {timeAgo}."
- "Restore" button and "Discard" link

- [ ] **Step 4: Wire `useDraft` into `routes.create.tsx`**

Changes:
- Import and call `useDraft('route', formValues, setFormValues)`
- Show `DraftBanner` when `hasDraft` is true
- Call `clearDraft()` after successful save in `handleCreate`

- [ ] **Step 5: Wire `useDraft` into `services.create.tsx`**

Same pattern as routes.

- [ ] **Step 6: Wire `useDraft` into `policies.create.tsx`**

Same pattern as routes.

- [ ] **Step 7: Verify tsc compiles**

---

## Task 4: Inline Form Validation (D4)

**Why:** Improves form UX by showing errors at the field level. Complements existing Zod validation.

**Files:**
- Create: `src/hooks/use-field-validation.ts`
- Create: `src/hooks/__tests__/use-field-validation.test.ts`
- Create: `src/components/rioku/field-error.tsx`
- Create: `src/components/rioku/__tests__/field-error.test.tsx`
- Modify: `src/routes/config/routes.create.tsx`
- Modify: `src/routes/config/services.create.tsx`
- Modify: `src/routes/config/policies.create.tsx`

- [ ] **Step 1: Create `FieldError` component**

File: `src/components/rioku/field-error.tsx`

Simple component:
```tsx
interface FieldErrorProps { message?: string; id?: string }
```
Renders a `<p>` with `role="alert"`, `className="text-xs text-destructive mt-1"`, and the given `id` (for `aria-describedby`).

- [ ] **Step 2: Create `useFieldValidation` hook**

File: `src/hooks/use-field-validation.ts`

Hook: `useFieldValidation(schema: ZodSchema, values: unknown)`

Returns:
- `errors: Record<string, string>` -- keyed by field path
- `validateField(path: string)` -- validates single field, updates errors
- `validateAll()` -- validates everything, returns boolean, focuses first invalid field
- `clearError(path: string)` -- remove single error
- `clearAll()` -- remove all errors

Uses `schema.safeParse` and maps Zod issues to field paths.

- [ ] **Step 3: Write tests for `FieldError`**

File: `src/components/rioku/__tests__/field-error.test.tsx`

- Renders message text
- Has role="alert"
- Renders nothing when no message
- Sets correct id for aria-describedby

- [ ] **Step 4: Write tests for `useFieldValidation`**

File: `src/hooks/__tests__/use-field-validation.test.ts`

- Returns empty errors initially
- validateAll returns errors for invalid fields
- validateField validates single field
- clearError removes single error
- clearAll removes all errors

- [ ] **Step 5: Wire inline validation into `routes.create.tsx`**

Changes:
- Import `useFieldValidation` with `routeFormSchema`
- Add `<FieldError>` below required fields (name, paths)
- Add `aria-invalid` and `aria-describedby` to inputs
- Add `onBlur` handler calling `validateField`
- Update `handleCreate` to call `validateAll` before submitting
- Add red border class when field has error: `border-destructive`

- [ ] **Step 6: Wire inline validation into `services.create.tsx`**

Same pattern: name, upstream address fields.

- [ ] **Step 7: Wire inline validation into `policies.create.tsx`**

Same pattern: name field + policy-specific config fields.

- [ ] **Step 8: Verify tsc compiles**

---

## Task 5: Optimistic Updates (D5)

**Why:** Makes toggle and delete feel instant. Leverages existing TanStack Query mutation hooks.

**Files:**
- Modify: `src/hooks/use-config-mutations.ts`
- Modify: `src/hooks/__tests__/use-config-mutations.test.tsx`

- [ ] **Step 1: Add optimistic toggle to `useRouteMutations`**

Modify: `src/hooks/use-config-mutations.ts`

Update `toggleMutation` to use optimistic updates:
```ts
onMutate: async (variables) => {
  await queryClient.cancelQueries({ queryKey: ['config'] })
  const previous = queryClient.getQueryData<ConfigSnapshot>(['config'])
  queryClient.setQueryData<ConfigSnapshot>(['config'], (old) => {
    if (!old) return old
    return {
      ...old,
      routes: old.routes.map((r) =>
        r.id === variables.id ? { ...r, enabled: !variables.enabled } : r
      ),
    }
  })
  return { previous }
},
onError: (_err, _vars, context) => {
  if (context?.previous) {
    queryClient.setQueryData(['config'], context.previous)
  }
  toast.error('Failed to toggle route')
},
onSettled: () => {
  queryClient.invalidateQueries({ queryKey: ['config'] })
},
```

Remove the existing `onSuccess` and `onError` and replace with this pattern.

- [ ] **Step 2: Add optimistic delete to `useRouteMutations`**

Same pattern for `deleteMutation`:
- `onMutate`: cancel queries, snapshot, remove route from cache
- `onError`: restore snapshot
- `onSettled`: invalidate

- [ ] **Step 3: Add optimistic delete to `useServiceMutations`**

Same pattern for service `deleteMutation`.

- [ ] **Step 4: Update tests for optimistic updates**

Modify: `src/hooks/__tests__/use-config-mutations.test.tsx`

Add test cases:
- Toggle mutation immediately updates cache
- Toggle mutation reverts on error
- Delete mutation immediately removes from cache
- Delete mutation reverts on error

- [ ] **Step 5: Verify tsc compiles**

---

## Task 6: Stale Data Indicators + Recently Viewed (D6)

**Why:** Gives users confidence in data freshness. Recently viewed speeds up repeat navigation.

**Files:**
- Create: `src/components/rioku/stale-indicator.tsx`
- Create: `src/components/rioku/__tests__/stale-indicator.test.tsx`
- Modify: `src/routes/config/routes.index.tsx` (add stale indicator)
- Modify: `src/routes/config/services.index.tsx` (add stale indicator)
- Modify: `src/routes/index.tsx` (add stale indicator + refresh button)
- Modify: `src/routes/config/routes.$routeId.tsx` (track recently viewed)
- Modify: `src/routes/config/services.$serviceId.tsx` (track recently viewed)

Note: `useRecentlyViewed` was already created in Task 1, Step 2. The command palette integration was in Task 1, Step 5. This task adds stale indicators and wires recently-viewed tracking into detail pages.

- [ ] **Step 1: Create `StaleIndicator` component**

File: `src/components/rioku/stale-indicator.tsx`

Component: `StaleIndicator({ dataUpdatedAt, onRefresh? })`
- Displays "Last updated X ago" using `<TimeAgo>`
- Optional refresh button (circular arrow icon)
- Faded text style: `text-xs text-muted-foreground`

- [ ] **Step 2: Write tests for `StaleIndicator`**

File: `src/components/rioku/__tests__/stale-indicator.test.tsx`

- Renders time ago text
- Shows refresh button when onRefresh provided
- Calls onRefresh when button clicked
- Does not show refresh button when onRefresh is undefined

- [ ] **Step 3: Add stale indicator to routes list page**

Modify: `src/routes/config/routes.index.tsx`

Add `<StaleIndicator>` in the page header area. Use `useQuery`'s `dataUpdatedAt` from the config query. Wire refresh to `queryClient.invalidateQueries({ queryKey: ['config'] })`.

- [ ] **Step 4: Add stale indicator to dashboard**

Modify: `src/routes/index.tsx`

Add `<StaleIndicator>` in the dashboard header with refresh button.

- [ ] **Step 5: Wire `useRecentlyViewed` into route detail page**

Modify: `src/routes/config/routes.$routeId.tsx`

Call `addRecent({ type: 'route', id: route.id, name: route.name, path: `/config/routes/${route.id}` })` in a `useEffect` on mount.

- [ ] **Step 6: Wire `useRecentlyViewed` into service detail page**

Modify: `src/routes/config/services.$serviceId.tsx`

Same pattern as route detail.

- [ ] **Step 7: Verify tsc compiles**

---

## Final Verification

After all tasks are complete:

- [ ] Run `source ~/.nvm/nvm.sh && npx tsc --noEmit` from `packages/web/`
- [ ] Run `source ~/.nvm/nvm.sh && npx vitest run` from `packages/web/`
- [ ] All tests pass, no type errors
- [ ] Do NOT merge -- report completion to parent agent
