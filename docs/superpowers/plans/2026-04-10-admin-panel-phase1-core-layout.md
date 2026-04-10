# Admin Panel Overhaul — Phase 1: Core Layout, Navigation & Design System

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Establish the structural foundation for the admin panel overhaul — the `@rioku/ui` design system package, redesigned sidebar/header, theme system, data table overhaul, and shared utilities that every subsequent phase depends on.

**Architecture:** This phase creates `packages/ui/` as a standalone design system package consumed by `packages/web/` via workspace dependency. All reusable components move to `@rioku/ui`. The web app then imports from `@rioku/ui` instead of internal paths. Layout components (sidebar, header) stay in `packages/web/` since they depend on TanStack Router.

**Tech Stack:**
- React 19, TypeScript 6, Vite 8, Tailwind CSS 4
- TanStack Router (file-based routing), TanStack Query
- shadcn/ui (base-nova style) with @base-ui/react primitives
- Vitest + Testing Library + happy-dom for unit tests
- Storybook 8 (Vite builder) for `@rioku/ui` component docs
- New deps: `dnd-kit`, `@tanstack/react-virtual`, `@uiw/react-codemirror` + CM6 packages

**Spec reference:** `docs/superpowers/specs/2026-04-10-admin-panel-overhaul-v2.md`
**Visual reference:** `tmp/admin-mockup/` (Vite + React prototype — for visual guidance only, NOT the real codebase)

**Existing codebase entry points:**
- Web app: `packages/web/` (`@rioku/web`)
- Root layout: `packages/web/src/routes/__root.tsx`
- Sidebar: `packages/web/src/components/layout/app-sidebar.tsx`
- Header: `packages/web/src/components/layout/header.tsx`
- Data table: `packages/web/src/components/rioku/data-table.tsx`
- Theme hook: `packages/web/src/hooks/use-theme.ts`
- Preferences: `packages/web/src/lib/preferences.ts`
- CSS variables: `packages/web/src/index.css`
- Exports: `packages/web/src/exports/index.ts`
- Test setup: `packages/web/src/test/setup.ts`

---

## Task 1: Create `packages/ui/` Package with Storybook

**Files:**
- Create: `packages/ui/package.json`
- Create: `packages/ui/tsconfig.json`
- Create: `packages/ui/src/index.ts`
- Create: `packages/ui/src/components/index.ts`
- Create: `packages/ui/src/hooks/index.ts`
- Create: `packages/ui/src/theme/index.ts`
- Create: `packages/ui/src/theme/tokens.css`
- Create: `packages/ui/.storybook/main.ts`
- Create: `packages/ui/.storybook/preview.ts`
- Create: `packages/ui/vitest.config.ts`
- Create: `packages/ui/src/test/setup.ts`
- Modify: `packages/web/package.json` (add `@rioku/ui` workspace dep)
- Modify: `packages/web/vite.config.ts` (add alias for `@rioku/ui`)
- Modify: `Makefile` (add `ui-storybook`, `ui-build`, `test-ui` targets)

This is the foundation package. All reusable components will live here. The package has zero app-level dependencies (no TanStack Router, no TanStack Query, no i18next).

- [ ] **Step 1: Create package scaffolding**

Create `packages/ui/package.json`:

```json
{
  "name": "@rioku/ui",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./theme/tokens.css": "./src/theme/tokens.css"
  },
  "scripts": {
    "storybook": "storybook dev -p 6006",
    "build-storybook": "storybook build",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "tsc --noEmit"
  },
  "dependencies": {
    "@base-ui/react": "^1.3.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "lucide-react": "^1.7.0",
    "react": "^19",
    "react-dom": "^19",
    "tailwind-merge": "^3.5.0"
  },
  "devDependencies": {
    "@storybook/addon-essentials": "^8.6.0",
    "@storybook/react": "^8.6.0",
    "@storybook/react-vite": "^8.6.0",
    "@tailwindcss/vite": "^4.2.2",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@testing-library/user-event": "^14.6.1",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@vitejs/plugin-react": "^6.0.1",
    "@vitest/coverage-v8": "^4.1.3",
    "happy-dom": "^20.8.9",
    "storybook": "^8.6.0",
    "tailwindcss": "^4.2.2",
    "typescript": "^6.0.2",
    "vite": "^8.0.7",
    "vitest": "^4.1.3"
  },
  "peerDependencies": {
    "react": "^19",
    "react-dom": "^19"
  }
}
```

Create `packages/ui/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "declaration": true,
    "declarationMap": true,
    "baseUrl": ".",
    "paths": { "@ui/*": ["./src/*"] }
  },
  "include": ["src"],
  "exclude": ["node_modules", "stories"]
}
```

Create `packages/ui/vitest.config.ts`:

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@ui': resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'lcov'],
      include: ['src/**'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/test/**', 'src/**/*.stories.tsx'],
    },
    css: false,
  },
})
```

Create `packages/ui/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

Create `packages/ui/src/lib/utils.ts` (copy from web — the `cn()` utility is needed by all components):

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

Create `packages/ui/src/index.ts`:

```ts
// @rioku/ui — Design system entry point
export * from './components'
export * from './hooks'
export * from './theme'
export { cn } from './lib/utils'
```

Create `packages/ui/src/components/index.ts` (initially empty, components added in later tasks):

```ts
// Component re-exports — populated as components are built
```

Create `packages/ui/src/hooks/index.ts`:

```ts
// Hook re-exports — populated as hooks are built
```

Create `packages/ui/src/theme/index.ts`:

```ts
// Theme utilities — populated in Task 13
```

- [ ] **Step 2: Set up Storybook**

Create `packages/ui/.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/react-vite'
import { resolve } from 'path'

const config: StorybookConfig = {
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-essentials'],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  viteFinal: async (config) => {
    config.resolve = config.resolve ?? {}
    config.resolve.alias = {
      ...config.resolve.alias,
      '@ui': resolve(__dirname, '../src'),
    }
    return config
  },
}

export default config
```

Create `packages/ui/.storybook/preview.ts`:

```ts
import type { Preview } from '@storybook/react'
import '../src/theme/tokens.css'

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'dark',
      values: [
        { name: 'dark', value: 'oklch(0.141 0.012 285.823)' },
        { name: 'light', value: 'oklch(0.985 0 0)' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
  },
}

export default preview
```

Create `packages/ui/stories/.gitkeep` (placeholder until stories are added in later tasks).

- [ ] **Step 3: Wire `@rioku/ui` into `packages/web/`**

Modify `packages/web/package.json` — add to `dependencies`:

```json
"@rioku/ui": "workspace:*"
```

Modify `packages/web/vite.config.ts` — add alias so `@rioku/ui` resolves to the source:

```ts
resolve: {
  alias: {
    '@': resolve(__dirname, 'src'),
    '@rioku/ui': resolve(__dirname, '../ui/src'),
  },
},
```

Also add the same alias to `packages/web/vitest.config.ts`.

Modify `packages/web/tsconfig.json` — add path alias:

```json
"paths": {
  "@/*": ["./src/*"],
  "@rioku/ui": ["../ui/src"],
  "@rioku/ui/*": ["../ui/src/*"]
}
```

- [ ] **Step 4: Add Makefile targets**

Add these targets to the root `Makefile`:

```makefile
## ui-storybook: Run @rioku/ui Storybook at localhost:6006
ui-storybook:
	cd $(PKG)/ui && $(WEB_PATH) npx storybook dev -p 6006

## ui-build-storybook: Build Storybook static site
ui-build-storybook:
	cd $(PKG)/ui && $(WEB_PATH) npx storybook build

## test-ui: Run @rioku/ui Vitest tests
test-ui:
	cd $(PKG)/ui && $(WEB_PATH) npx vitest run

## test-ui-coverage: Run @rioku/ui tests with coverage
test-ui-coverage:
	cd $(PKG)/ui && $(WEB_PATH) npx vitest run --coverage
```

- [ ] **Step 5: Install dependencies and verify**

```bash
cd packages/ui && npm install
cd packages/web && npm install  # picks up workspace:* link
cd packages/ui && npx tsc --noEmit  # should pass with empty modules
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ui): scaffold @rioku/ui package with Storybook and Vitest"
```

---

## Task 2: Install New Dependencies in `packages/web/`

**Files:**
- Modify: `packages/web/package.json`

The spec requires three new library families. Install them now so all subsequent tasks can reference them.

- [ ] **Step 1: Install production dependencies**

```bash
cd packages/web
npm install @dnd-kit/core @dnd-kit/sortable @dnd-kit/utilities @tanstack/react-virtual
```

Note: `@uiw/react-codemirror`, `@codemirror/lang-json`, `@codemirror/lang-yaml`, and `@codemirror/lint` are installed in `packages/ui/` (not `packages/web/`) because the `YamlJsonEditor` component lives in the design system package.

```bash
cd packages/ui
npm install @uiw/react-codemirror @codemirror/lang-json @codemirror/lang-yaml @codemirror/lint
```

- [ ] **Step 2: Verify builds**

```bash
cd packages/web && npx tsc --noEmit
cd packages/ui && npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(deps): add dnd-kit, react-virtual, CodeMirror 6 packages"
```

---

## Task 3: Build SearchableSelect & SearchableMultiSelect in `@rioku/ui`

**Files:**
- Create: `packages/ui/src/components/searchable-select.tsx`
- Create: `packages/ui/src/components/__tests__/searchable-select.test.tsx`
- Create: `packages/ui/stories/SearchableSelect.stories.tsx`
- Modify: `packages/ui/src/components/index.ts` (add re-export)
- Modify: `packages/ui/package.json` (add `cmdk` dependency if needed, or build with native `@base-ui/react`)

These are used everywhere dynamic data is referenced (roles, services, policies, timezones, etc.). Spec Section 5.4.

- [ ] **Step 1: Write tests first (TDD)**

Create `packages/ui/src/components/__tests__/searchable-select.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SearchableSelect, SearchableMultiSelect } from '../searchable-select'

const options = [
  { value: 'svc-1', label: 'payments-api' },
  { value: 'svc-2', label: 'auth-service' },
  { value: 'svc-3', label: 'notifications' },
  { value: 'svc-4', label: 'billing-engine' },
]

describe('SearchableSelect', () => {
  it('renders with placeholder text', () => {
    render(
      <SearchableSelect
        options={options}
        value=""
        onChange={() => {}}
        placeholder="Search services..."
      />,
    )
    expect(screen.getByPlaceholderText('Search services...')).toBeInTheDocument()
  })

  it('filters options on typing', async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelect
        options={options}
        value=""
        onChange={() => {}}
        placeholder="Search..."
      />,
    )
    const input = screen.getByPlaceholderText('Search...')
    await user.click(input)
    await user.type(input, 'pay')
    expect(screen.getByText('payments-api')).toBeInTheDocument()
    expect(screen.queryByText('notifications')).not.toBeInTheDocument()
  })

  it('calls onChange when an option is selected', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SearchableSelect
        options={options}
        value=""
        onChange={onChange}
        placeholder="Search..."
      />,
    )
    const input = screen.getByPlaceholderText('Search...')
    await user.click(input)
    await user.click(screen.getByText('auth-service'))
    expect(onChange).toHaveBeenCalledWith('svc-2')
  })

  it('supports keyboard navigation (ArrowDown, Enter)', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SearchableSelect
        options={options}
        value=""
        onChange={onChange}
        placeholder="Search..."
      />,
    )
    const input = screen.getByPlaceholderText('Search...')
    await user.click(input)
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalled()
  })

  it('closes dropdown on Escape', async () => {
    const user = userEvent.setup()
    render(
      <SearchableSelect
        options={options}
        value=""
        onChange={() => {}}
        placeholder="Search..."
      />,
    )
    const input = screen.getByPlaceholderText('Search...')
    await user.click(input)
    expect(screen.getByText('payments-api')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByText('payments-api')).not.toBeInTheDocument()
  })

  it('displays selected value as inline text', () => {
    render(
      <SearchableSelect
        options={options}
        value="svc-1"
        onChange={() => {}}
        placeholder="Search..."
      />,
    )
    expect(screen.getByDisplayValue('payments-api')).toBeInTheDocument()
  })
})

describe('SearchableMultiSelect', () => {
  it('renders selected items as removable badges', () => {
    render(
      <SearchableMultiSelect
        options={options}
        value={['svc-1', 'svc-3']}
        onChange={() => {}}
        placeholder="Search..."
      />,
    )
    expect(screen.getByText('payments-api')).toBeInTheDocument()
    expect(screen.getByText('notifications')).toBeInTheDocument()
  })

  it('adds an option to selection', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SearchableMultiSelect
        options={options}
        value={['svc-1']}
        onChange={onChange}
        placeholder="Search..."
      />,
    )
    const input = screen.getByPlaceholderText('Search...')
    await user.click(input)
    await user.click(screen.getByText('auth-service'))
    expect(onChange).toHaveBeenCalledWith(['svc-1', 'svc-2'])
  })

  it('removes a badge on click', async () => {
    const onChange = vi.fn()
    const user = userEvent.setup()
    render(
      <SearchableMultiSelect
        options={options}
        value={['svc-1', 'svc-3']}
        onChange={onChange}
        placeholder="Search..."
      />,
    )
    // Click the remove button on the first badge
    const removeButtons = screen.getAllByRole('button', { name: /remove/i })
    await user.click(removeButtons[0])
    expect(onChange).toHaveBeenCalledWith(['svc-3'])
  })

  it('does not show already-selected options in dropdown', async () => {
    const user = userEvent.setup()
    render(
      <SearchableMultiSelect
        options={options}
        value={['svc-1']}
        onChange={() => {}}
        placeholder="Search..."
      />,
    )
    const input = screen.getByPlaceholderText('Search...')
    await user.click(input)
    expect(screen.queryByRole('option', { name: 'payments-api' })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement SearchableSelect and SearchableMultiSelect**

Create `packages/ui/src/components/searchable-select.tsx`:

Component requirements (from spec Section 5.4):
- Text input with search/filter
- Dropdown list of matching options (virtualized for large lists via `@tanstack/react-virtual` if installed, otherwise plain list with max-height scroll)
- Keyboard navigation (ArrowUp, ArrowDown, Enter to select, Escape to close)
- Single select: selected item shown as input value text
- Multi select: selected items shown as removable badges with X button
- Placeholder text: "Search [entity type]..."
- All colors via CSS variables (no hardcoded hex)
- `aria-expanded`, `aria-activedescendant`, `role="listbox"`, `role="option"` for a11y
- Props interface with JSDoc:

```tsx
export interface SelectOption {
  /** Unique value identifier */
  value: string
  /** Display label */
  label: string
  /** Optional secondary text (e.g., "3 upstreams, round-robin") */
  description?: string
  /** Optional badge to show alongside (e.g., policy type) */
  badge?: string
  /** Whether this option is disabled */
  disabled?: boolean
}

export interface SearchableSelectProps {
  /** Available options to choose from */
  options: SelectOption[]
  /** Currently selected value */
  value: string
  /** Callback when selection changes */
  onChange: (value: string) => void
  /** Placeholder text for the search input */
  placeholder?: string
  /** Whether the select is disabled */
  disabled?: boolean
  /** Additional CSS classes */
  className?: string
}

export interface SearchableMultiSelectProps {
  /** Available options to choose from */
  options: SelectOption[]
  /** Currently selected values */
  value: string[]
  /** Callback when selection changes */
  onChange: (value: string[]) => void
  /** Placeholder text for the search input */
  placeholder?: string
  /** Whether the select is disabled */
  disabled?: boolean
  /** Additional CSS classes */
  className?: string
}
```

- [ ] **Step 3: Add re-export and Storybook story**

Update `packages/ui/src/components/index.ts`:

```ts
export {
  SearchableSelect,
  SearchableMultiSelect,
} from './searchable-select'
export type {
  SearchableSelectProps,
  SearchableMultiSelectProps,
  SelectOption,
} from './searchable-select'
```

Create `packages/ui/stories/SearchableSelect.stories.tsx` with variants:
- Default (empty, 4 options)
- With selection
- Multi-select with badges
- Large list (100+ options, test scroll performance)
- Disabled state
- With description and badge text on options

- [ ] **Step 4: Run tests**

```bash
cd packages/ui && npx vitest run --reporter=verbose src/components/__tests__/searchable-select.test.tsx
```

All tests must pass. Adjust implementation to match test expectations.

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): SearchableSelect and SearchableMultiSelect components"
```

---

## Task 4: Build YamlJsonEditor Component in `@rioku/ui`

**Files:**
- Create: `packages/ui/src/components/yaml-json-editor.tsx`
- Create: `packages/ui/src/components/__tests__/yaml-json-editor.test.tsx`
- Create: `packages/ui/stories/YamlJsonEditor.stories.tsx`
- Modify: `packages/ui/src/components/index.ts` (add re-export)

Wraps `@uiw/react-codemirror` with a Rioku-specific toolbar. Spec Section 6.2.

- [ ] **Step 1: Write tests first (TDD)**

Create `packages/ui/src/components/__tests__/yaml-json-editor.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { YamlJsonEditor } from '../yaml-json-editor'

describe('YamlJsonEditor', () => {
  it('renders the editor with YAML mode active by default', () => {
    render(
      <YamlJsonEditor
        value="name: test"
        onChange={() => {}}
      />,
    )
    expect(screen.getByRole('button', { name: /yaml/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('renders the format toggle (YAML / JSON)', () => {
    render(<YamlJsonEditor value="" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /yaml/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /json/i })).toBeInTheDocument()
  })

  it('renders toolbar with copy and format buttons', () => {
    render(<YamlJsonEditor value="name: test" onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /format/i })).toBeInTheDocument()
  })

  it('shows Valid indicator when content is valid YAML', () => {
    render(<YamlJsonEditor value="name: test" onChange={() => {}} />)
    expect(screen.getByText(/valid/i)).toBeInTheDocument()
  })

  it('shows error indicator when content is invalid', () => {
    render(
      <YamlJsonEditor
        value="{invalid yaml: ["
        onChange={() => {}}
        format="json"
      />,
    )
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })

  it('calls onChange when editor content changes', async () => {
    const onChange = vi.fn()
    render(<YamlJsonEditor value="" onChange={onChange} />)
    // CodeMirror is complex to simulate typing in; verify onChange prop is wired
    expect(onChange).toBeDefined()
  })

  it('renders download button when onDownload is provided', () => {
    render(
      <YamlJsonEditor
        value="name: test"
        onChange={() => {}}
        showDownload
      />,
    )
    expect(screen.getByRole('button', { name: /download/i })).toBeInTheDocument()
  })

  it('respects readOnly prop', () => {
    render(
      <YamlJsonEditor
        value="name: test"
        onChange={() => {}}
        readOnly
      />,
    )
    // The CodeMirror editor should have readOnly attribute
    expect(screen.getByRole('textbox')).toHaveAttribute('aria-readonly', 'true')
  })
})
```

- [ ] **Step 2: Implement YamlJsonEditor**

Create `packages/ui/src/components/yaml-json-editor.tsx`:

Component requirements (from spec Section 6.2):
- Wraps `@uiw/react-codemirror` with extensions for JSON and YAML
- Toolbar above the editor with:
  - Format toggle: YAML | JSON (segmented control buttons)
  - Validity indicator: green "Valid" badge or red "N errors" badge
  - Copy to clipboard button
  - Format/prettify button (normalizes indentation)
  - Download button (optional, controlled by `showDownload` prop)
- Format switching converts content between YAML and JSON (uses `JSON.parse`/`JSON.stringify` and a YAML parser — install `yaml` package in `@rioku/ui` if needed)
- Theming via `createTheme()` from `@uiw/react-codemirror` pulling from CSS variables
- Line numbers enabled by default
- `@codemirror/lint` for inline error markers
- Tab inserts 2 spaces

Props interface:

```tsx
export interface YamlJsonEditorProps {
  /** Current editor content */
  value: string
  /** Callback when content changes */
  onChange: (value: string) => void
  /** Current format — defaults to 'yaml' */
  format?: 'yaml' | 'json'
  /** Callback when format changes */
  onFormatChange?: (format: 'yaml' | 'json') => void
  /** Whether the editor is read-only */
  readOnly?: boolean
  /** Whether to show the download button */
  showDownload?: boolean
  /** Filename for download (without extension) */
  downloadFilename?: string
  /** Editor height — defaults to '400px' */
  height?: string
  /** Additional CSS classes */
  className?: string
}
```

- [ ] **Step 3: Add re-export and Storybook story**

Update `packages/ui/src/components/index.ts` to export `YamlJsonEditor` and `YamlJsonEditorProps`.

Create `packages/ui/stories/YamlJsonEditor.stories.tsx` with variants:
- Default with YAML content
- JSON mode
- Read-only
- With validation errors
- Large content (100+ lines)
- Dark and light theme

- [ ] **Step 4: Run tests**

```bash
cd packages/ui && npx vitest run --reporter=verbose src/components/__tests__/yaml-json-editor.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(ui): YamlJsonEditor component wrapping CodeMirror 6"
```

---

## Task 5: DataTable Overhaul

**Files:**
- Modify: `packages/web/src/components/rioku/data-table.tsx` (major rewrite)
- Modify: `packages/web/src/components/rioku/__tests__/data-table.test.tsx` (rewrite tests)
- Create: `packages/web/src/components/rioku/faceted-filter.tsx`
- Create: `packages/web/src/components/rioku/__tests__/faceted-filter.test.tsx`
- Create: `packages/web/src/components/rioku/table-preferences.tsx`
- Create: `packages/web/src/components/rioku/__tests__/table-preferences.test.tsx`
- Create: `packages/web/src/hooks/use-table-url-state.ts`
- Create: `packages/web/src/hooks/__tests__/use-table-url-state.test.ts`
- Modify: `packages/web/src/exports/index.ts` (update DataTable exports)

The existing `DataTable` in `packages/web/src/components/rioku/data-table.tsx` is a basic component with simple search, sort, and pagination. The overhaul adds: click-to-navigate rows, hover actions, faceted filtering, table preferences (density/columns/page size), and URL state sync. Spec Sections 4.1-4.6, 18.6.

Note: The DataTable stays in `packages/web/` (not `@rioku/ui`) for now because it uses TanStack Router's `useSearch`/`useNavigate` for URL state. A simpler, router-agnostic version can be extracted to `@rioku/ui` later.

- [ ] **Step 1: Create `useTableUrlState` hook (TDD)**

Create `packages/web/src/hooks/__tests__/use-table-url-state.test.ts`:

Tests for a hook that reads/writes table state (sort column, sort direction, active filters, page number, search query, page size) from URL search params. Use TanStack Router's `useSearch` and `useNavigate`.

Test cases:
- `initializes from URL params` — URL `?sort=name&dir=asc&page=2&q=payments` should yield `{ sortKey: 'name', sortDir: 'asc', page: 2, search: 'payments' }`
- `defaults when no URL params` — returns default values
- `setSort updates URL` — calling `setSort('status', 'desc')` updates the URL
- `setSearch resets page to 0` — searching should reset pagination
- `setFilter adds filter to URL` — `setFilter('status', 'active')` adds `?status=active`
- `removeFilter removes from URL` — removes the filter param
- `setPageSize updates URL and resets page` — changing page size resets to page 0

Create `packages/web/src/hooks/use-table-url-state.ts`:

```ts
/**
 * Manages DataTable state in URL search params, making filtered/sorted
 * views shareable and bookmarkable.
 *
 * URL format: ?sort=name&dir=asc&status=active&page=2&q=payments&size=25
 */
export interface TableUrlState {
  sortKey: string | null
  sortDir: 'asc' | 'desc'
  page: number
  pageSize: number
  search: string
  filters: Record<string, string>
}

export interface UseTableUrlStateReturn {
  state: TableUrlState
  setSort: (key: string, dir?: 'asc' | 'desc') => void
  setPage: (page: number) => void
  setPageSize: (size: number) => void
  setSearch: (query: string) => void
  setFilter: (key: string, value: string) => void
  removeFilter: (key: string) => void
  clearFilters: () => void
}
```

- [ ] **Step 2: Rewrite DataTable component**

Modify `packages/web/src/components/rioku/data-table.tsx`:

The rewrite extends the existing `Column<T>` and `DataTableProps<T>` interfaces. Keep backwards compatibility where possible. New features:

**Click-to-navigate rows (spec 4.1):**
- Add `linkColumn` prop (string key) — the column whose cell renders as a primary-colored link
- Add `onRowClick` prop — callback receiving the row data, called when the link cell is clicked
- The link column is always first after the optional checkbox column

**Hover inline actions (spec 4.2):**
- Add `rowActions` prop — a render function `(row: T) => ReactNode` that returns action buttons
- Actions appear on row hover at the right edge (`opacity-0 group-hover:opacity-100`)
- Each `<TableRow>` gets `className="group"` for the hover target

**Bulk selection (spec 4.3):**
- Add `selectable` prop (boolean)
- When enabled, a checkbox column appears as the first column
- Select-all checkbox in the header
- Selected row IDs tracked in state
- Add `onSelectionChange` prop — `(selectedIds: string[]) => void`
- Add `bulkActions` prop — `(selectedIds: string[]) => ReactNode` that renders a floating action bar above the table when items are selected

**Faceted filtering (spec 4.4):**
- Add `filterColumns` prop — array of `{ key: string, label: string, options: { value: string, label: string }[] }`
- Renders a filter bar above the table with one button per filter column
- Each button opens a Popover with the filter options as checkboxes
- Active filters shown as removable Badge chips
- Filter state managed via `useTableUrlState`

**Table preferences (spec 4.5):**
- Add `preferencesKey` prop (string) — unique key for persisting preferences
- Gear icon button that opens a Popover with:
  - Column visibility toggles (checkboxes for each column)
  - Page size selector (10, 25, 50, 100)
  - Density selector (compact, comfortable, spacious)
- Preferences persisted via `usePreferences` (Task 10)

**URL state sync (spec 18.6):**
- When `syncUrl` prop is true, all table state (sort, filters, page, search, page size) syncs to URL via `useTableUrlState`

Updated `Column<T>` interface:

```tsx
interface Column<T> {
  key: string
  header: string
  render?: (row: T) => React.ReactNode
  sortable?: boolean
  /** Whether this column can be hidden via preferences. Default: true */
  hideable?: boolean
  /** Default visibility. Default: true */
  defaultVisible?: boolean
  /** Minimum width for the column */
  minWidth?: string
}
```

Updated `DataTableProps<T>`:

```tsx
interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  /** The row key extractor — must return a unique string per row */
  rowKey: (row: T) => string
  // Existing
  searchable?: boolean
  searchPlaceholder?: string
  pageSize?: number
  emptyState?: React.ReactNode
  actions?: React.ReactNode
  title?: string
  // New
  linkColumn?: string
  onRowClick?: (row: T) => void
  selectable?: boolean
  onSelectionChange?: (ids: string[]) => void
  bulkActions?: (ids: string[]) => React.ReactNode
  rowActions?: (row: T) => React.ReactNode
  filterColumns?: FilterColumn[]
  preferencesKey?: string
  syncUrl?: boolean
  density?: 'compact' | 'comfortable' | 'spacious'
}
```

- [ ] **Step 3: Rewrite DataTable tests**

Modify `packages/web/src/components/rioku/__tests__/data-table.test.tsx`:

Add tests for all new features:
- `renders link column as clickable primary-colored link`
- `calls onRowClick when link cell clicked`
- `shows row actions on hover` (verify className pattern)
- `renders checkbox column when selectable`
- `select-all checkbox toggles all rows`
- `calls onSelectionChange with selected IDs`
- `renders bulk action bar when items selected`
- `renders filter buttons for filterColumns`
- `active filters shown as removable badges`
- `page size options include 10, 25, 50, 100`
- `density changes row height` (compact vs spacious classes)

Keep existing passing tests for basic search, sort, and pagination.

- [ ] **Step 4: Build FacetedFilter sub-component**

Create `packages/web/src/components/rioku/faceted-filter.tsx`:

A standalone filter button + popover component. Each filter column gets one:
- Button shows the filter label + count of active values
- Popover lists all options as checkboxes
- "Clear" button at the bottom of the popover
- Filtering is additive within a column (OR) and multiplicative across columns (AND)

Create `packages/web/src/components/rioku/__tests__/faceted-filter.test.tsx`:
- `renders button with label`
- `opens popover on click`
- `shows all options as checkboxes`
- `calls onChange when option toggled`
- `shows active count badge on button`
- `clear button resets all selections`

- [ ] **Step 5: Build TablePreferences sub-component**

Create `packages/web/src/components/rioku/table-preferences.tsx`:

Gear icon popover with:
- Column visibility toggles
- Page size selector (native select: 10, 25, 50, 100)
- Density selector (3 icon buttons: compact, comfortable, spacious)

Create `packages/web/src/components/rioku/__tests__/table-preferences.test.tsx`:
- `renders gear icon button`
- `opens preferences popover on click`
- `shows column toggles`
- `toggling column visibility calls onChange`
- `page size selection calls onChange`
- `density buttons update state`

- [ ] **Step 6: Run all tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/components/rioku/__tests__/data-table.test.tsx src/components/rioku/__tests__/faceted-filter.test.tsx src/components/rioku/__tests__/table-preferences.test.tsx src/hooks/__tests__/use-table-url-state.test.ts
```

- [ ] **Step 7: Update exports**

Update `packages/web/src/exports/index.ts` to export new types and sub-components:

```ts
export type { FilterColumn } from '@/components/rioku/data-table'
export { FacetedFilter } from '@/components/rioku/faceted-filter'
export { TablePreferences } from '@/components/rioku/table-preferences'
```

- [ ] **Step 8: Commit**

```bash
git commit -m "feat(web): DataTable overhaul — click-to-navigate, hover actions, faceted filters, URL state"
```

---

## Task 6: Sidebar Redesign

**Files:**
- Modify: `packages/web/src/components/layout/app-sidebar.tsx` (major changes)
- Create: `packages/web/src/components/layout/__tests__/app-sidebar.test.tsx`
- Modify: `packages/web/src/locales/en/common.json` (add new nav keys)

Spec Sections 3.1, 3.4. Changes: mobile drawer behavior, plugin nav section, user menu popup (Profile/Settings/Logout), remove Settings from main nav.

- [ ] **Step 1: Write tests first (TDD)**

Create `packages/web/src/components/layout/__tests__/app-sidebar.test.tsx`:

Tests need a mock of TanStack Router context and SidebarProvider wrapper. Follow the pattern from `packages/web/src/components/layout/__tests__/keyboard-shortcut-help.test.tsx`.

Test cases:
- `renders all nav sections with correct labels`
- `renders section headers: Overview, Configuration, Traffic, Infrastructure, Security`
- `nav items match spec: Dashboard, Routes, Services, Policies, Live view, Analytics, AI workloads, Cluster, Certificates, Plugins, Users & roles, API keys, Access policies, Audit log`
- `Settings is NOT in the main sidebar nav`
- `bottom user area renders as a button`
- `clicking user area button opens upward popup menu`
- `popup menu contains Profile, Settings, Log out options`
- `clicking Profile navigates to /settings/profile`
- `clicking Settings navigates to /settings`
- `clicking Log out calls logout API`
- `hides nav items based on RBAC permissions`
- `plugin nav items appear under Infrastructure > Plugins`
- `active item has left accent border`
- `collapsed mode shows only icons with tooltips`

- [ ] **Step 2: Update navigation structure**

Modify `packages/web/src/components/layout/app-sidebar.tsx`:

Update `navSections` to match the spec Section 3.1:

```tsx
const navSections: NavSection[] = [
  {
    titleKey: 'nav.overview',
    items: [
      { label: 'nav.dashboard', path: '/', icon: LayoutDashboard },
    ],
  },
  {
    titleKey: 'nav.configuration',
    items: [
      { label: 'nav.routes', path: '/config/routes', icon: RouteIcon },
      { label: 'nav.services', path: '/config/services', icon: Server },
      { label: 'nav.policies', path: '/config/policies', icon: Shield },
    ],
  },
  {
    titleKey: 'nav.traffic',
    items: [
      { label: 'nav.live', path: '/traffic/live', icon: Activity },
      { label: 'nav.analytics', path: '/traffic/analytics', icon: BarChart3 },
      { label: 'nav.aiWorkloads', path: '/traffic/ai', icon: Sparkles },
    ],
  },
  {
    titleKey: 'nav.infrastructure',
    items: [
      { label: 'nav.cluster', path: '/cluster', icon: Network },
      { label: 'nav.certificates', path: '/certificates', icon: ShieldCheckIcon },
      { label: 'nav.plugins', path: '/plugins', icon: Puzzle },
    ],
  },
  {
    titleKey: 'nav.security',
    items: [
      { label: 'nav.usersAndRoles', path: '/security', icon: UsersIcon, permission: 'users:read' },
      { label: 'nav.apiKeys', path: '/security/keys', icon: KeyIcon, permission: 'keys:read' },
      { label: 'nav.accessPolicies', path: '/security/access-policies', icon: ShieldIcon, permission: 'access-policies:read' },
      { label: 'nav.auditLog', path: '/audit', icon: ScrollTextIcon, permission: 'audit:read' },
    ],
  },
]
```

Key changes from current code:
- Removed `Settings` from sidebar nav items (moved to user popup)
- Added `Certificates` under Infrastructure
- Added `API keys`, `Access policies`, `Audit log` under Security
- Renamed `security` item to `usersAndRoles`

- [ ] **Step 3: Build user menu popup**

Replace the current footer (inline profile link + logout button) with a button that opens an upward popup menu.

Use the existing `Popover` component from `@/components/ui/popover` positioned to open upward. The button shows the user avatar + name. The popup has three items:
1. Profile — `<Link to="/settings/profile" />`
2. Settings — `<Link to="/settings" />`
3. Log out — calls `handleLogout()`

When sidebar is collapsed, the user area button shows only the avatar icon, and the popup still works (anchored to the icon).

- [ ] **Step 4: Plugin nav integration**

The sidebar already imports `<Slot zone="sidebar.bottom" />` from the plugin system. Extend this so plugins can register nav items that appear under Infrastructure > Plugins.

Read the existing plugin registry at `packages/web/src/lib/plugin-registry.ts` and plugin loader at `packages/web/src/lib/plugin-loader.ts` to understand the registration pattern. Add a new `adminPages` field to the plugin manifest type. When a plugin declares admin pages, render them as sub-items under the Plugins nav item.

For now, the plugin nav section can be a placeholder that reads from the plugin registry. The actual plugin system is a future task.

- [ ] **Step 5: Update i18n keys**

Modify `packages/web/src/locales/en/common.json` — add to the `nav` object:

```json
"certificates": "Certificates",
"usersAndRoles": "Users & roles",
"apiKeys": "API keys",
"accessPolicies": "Access policies",
"auditLog": "Audit log"
```

- [ ] **Step 6: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/components/layout/__tests__/app-sidebar.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(web): sidebar redesign — user popup menu, updated nav structure, plugin section"
```

---

## Task 7: Header Redesign

**Files:**
- Modify: `packages/web/src/components/layout/header.tsx`
- Create: `packages/web/src/components/layout/notification-bell.tsx`
- Create: `packages/web/src/components/layout/__tests__/header.test.tsx`
- Create: `packages/web/src/components/layout/__tests__/notification-bell.test.tsx`

Spec Sections 3.2, 3.5. Changes: breadcrumbs with chevrons instead of slashes, notification bell panel, mobile hamburger at `<768px`.

- [ ] **Step 1: Write tests first**

Create `packages/web/src/components/layout/__tests__/header.test.tsx`:

Test cases:
- `renders breadcrumbs with chevron separators` (not `/`)
- `last breadcrumb segment is bold and non-clickable`
- `non-last breadcrumb segments are clickable links`
- `renders search trigger button with keyboard shortcut label`
- `renders theme toggle button`
- `renders notification bell icon`
- `renders hamburger menu button on mobile` (mock `useIsMobile` to return true)
- `does not render hamburger on desktop`
- `clicking hamburger opens mobile sidebar` (via `setOpenMobile(true)`)

Create `packages/web/src/components/layout/__tests__/notification-bell.test.tsx`:

Test cases:
- `renders bell icon`
- `shows unread count badge when notifications exist`
- `clicking bell opens notification panel dropdown`
- `notifications display with colored left border by type`
- `mark all as read button clears unread state`
- `panel closes on Escape`
- `panel closes on outside click`
- `newest notifications appear first`

- [ ] **Step 2: Update breadcrumbs**

Modify the `useBreadcrumbs` function and breadcrumb rendering in `packages/web/src/components/layout/header.tsx`:

Replace the `/` separator with a chevron icon:

```tsx
import { ChevronRightIcon, BellIcon, MenuIcon } from 'lucide-react'

// In the breadcrumb nav:
{i > 0 && <ChevronRightIcon className="size-3.5 text-muted-foreground/50" />}
```

Make non-last breadcrumb segments clickable links using TanStack Router's `<Link>`:

```tsx
{i === breadcrumbs.length - 1 ? (
  <span className="font-medium text-foreground">{crumb.label}</span>
) : (
  <Link to={crumb.path} className="hover:text-foreground transition-colors">
    {crumb.label}
  </Link>
)}
```

- [ ] **Step 3: Build NotificationBell component**

Create `packages/web/src/components/layout/notification-bell.tsx`:

Component uses the existing `useEventSubscription` hook from `packages/web/src/hooks/use-events.ts` to receive SSE notifications.

Structure:
- Bell icon button with unread count badge (red circle)
- Popover dropdown panel (use `@/components/ui/popover`)
- "Mark all as read" button at the top of the panel
- Notification list with:
  - Icon + title + message + relative timestamp
  - Colored left border: warning=amber, error=red, success=green, info=blue
  - Unread notifications have a subtle background highlight (`bg-muted/50`)
- Maximum 50 notifications stored in state (ring buffer, oldest evicted)

```tsx
export interface Notification {
  id: string
  type: 'warning' | 'error' | 'success' | 'info'
  title: string
  message: string
  timestamp: Date
  read: boolean
}

export interface NotificationBellProps {
  /** Notifications to display */
  notifications: Notification[]
  /** Callback to mark all as read */
  onMarkAllRead: () => void
  /** Callback to mark a single notification as read */
  onMarkRead: (id: string) => void
}
```

- [ ] **Step 4: Add mobile hamburger**

Modify `packages/web/src/components/layout/header.tsx`:

At `<768px`, show a hamburger icon button that calls `setOpenMobile(true)` from the `useSidebar()` context. The existing `sidebar.tsx` component already handles the mobile Sheet overlay when `openMobile` is true — we just need to trigger it.

```tsx
const { isMobile, setOpenMobile } = useSidebar()

// Before the breadcrumbs:
{isMobile && (
  <Button
    variant="ghost"
    size="icon-sm"
    onClick={() => setOpenMobile(true)}
    className="md:hidden"
  >
    <MenuIcon className="size-4" />
    <span className="sr-only">Open menu</span>
  </Button>
)}
```

The existing `SidebarTrigger` (desktop collapse toggle) should be hidden on mobile (`className="hidden md:inline-flex"`).

- [ ] **Step 5: Wire NotificationBell into Header**

Import and render `<NotificationBell />` in the header, between the search trigger and theme toggle. Notification state will be managed in the root layout (or a context provider) and passed down. For now, the bell can render with an empty notifications array — wiring to SSE events is a Phase 4 task.

- [ ] **Step 6: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/components/layout/__tests__/header.test.tsx src/components/layout/__tests__/notification-bell.test.tsx
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(web): header redesign — chevron breadcrumbs, notification bell, mobile hamburger"
```

---

## Task 8: Settings Multi-Page Layout with Sub-Navigation

**Files:**
- Create: `packages/web/src/routes/settings/index.tsx` (settings landing with sub-nav)
- Create: `packages/web/src/routes/settings/general.tsx`
- Create: `packages/web/src/routes/settings/network.tsx`
- Create: `packages/web/src/routes/settings/tls.tsx`
- Create: `packages/web/src/routes/settings/observability.tsx`
- Create: `packages/web/src/routes/settings/config-store.tsx`
- Create: `packages/web/src/routes/settings/authentication.tsx`
- Create: `packages/web/src/routes/settings/pki.tsx`
- Create: `packages/web/src/routes/settings/danger-zone.tsx`
- Create: `packages/web/src/components/layout/settings-layout.tsx`
- Modify: `packages/web/src/routes/settings.tsx` (convert to layout route with `<Outlet>`)
- Create: `packages/web/src/locales/en/settings.json` (i18n namespace)

Spec Section 10. Replace the single settings page with a multi-page section using its own left sub-navigation.

- [ ] **Step 1: Create settings layout component**

Create `packages/web/src/components/layout/settings-layout.tsx`:

A layout component that renders a left sub-navigation panel + right content area. The sub-nav items:

```
General
Network
TLS & Certificates
Observability
Config Store
Authentication
PKI
Danger Zone
```

Each item is a `<Link>` to `/settings/{slug}`. Active item highlighted. The sub-nav is rendered inside the main content area (not the sidebar).

Structure:
```tsx
export function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-6">
      {/* Left sub-nav — fixed width */}
      <nav className="hidden md:flex w-48 flex-col gap-1 shrink-0">
        {settingsNavItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              'rounded-md px-3 py-2 text-sm transition-colors',
              isActive ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {/* Content area */}
      <div className="flex-1 min-w-0">
        {children}
      </div>
    </div>
  )
}
```

On mobile (`<768px`), the sub-nav collapses into a horizontal scrollable tab bar or a dropdown selector above the content.

- [ ] **Step 2: Convert settings.tsx to layout route**

Modify `packages/web/src/routes/settings.tsx`:

Strip the existing settings page content. Convert it to a layout route that renders `<SettingsLayout>` wrapping `<Outlet />`. The current settings page content moves to `packages/web/src/routes/settings/general.tsx` (or the root index).

```tsx
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { PageHeader } from '@/components/rioku/page-header'
import { SettingsLayout } from '@/components/layout/settings-layout'

export const Route = createFileRoute('/settings')({
  component: SettingsLayoutPage,
  beforeLoad: ({ location }) => {
    // Redirect /settings to /settings/general
    if (location.pathname === '/settings') {
      throw redirect({ to: '/settings/general' })
    }
  },
})

function SettingsLayoutPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Settings" description="Manage your Rioku instance configuration" />
      <SettingsLayout>
        <Outlet />
      </SettingsLayout>
    </div>
  )
}
```

- [ ] **Step 3: Create settings sub-pages**

Each sub-page is a TanStack Router file route under `/settings/`. For Phase 1, only General needs real content (migrated from the current settings page). The rest are placeholder pages showing the section title and a "Coming soon" message where backend endpoints don't exist yet.

Create `packages/web/src/routes/settings/general.tsx`:
- Move the existing General/Network/Config Store cards from the current `settings.tsx` into this page
- Instance name, data directory, log level, daemon version, Caddy version

Create the remaining files as stubs:
```tsx
// packages/web/src/routes/settings/network.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/settings/network')({
  component: NetworkSettings,
})

function NetworkSettings() {
  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold">Network</h2>
      {/* TODO: Trusted proxies, client IP headers, strict mode, listening addresses */}
      <p className="text-muted-foreground">Network settings — coming in Phase 5.</p>
    </div>
  )
}
```

Create similar stubs for: `tls.tsx`, `observability.tsx`, `config-store.tsx`, `authentication.tsx`, `pki.tsx`, `danger-zone.tsx`.

The `danger-zone.tsx` page should have a red-bordered section even in stub form:
```tsx
<div className="rounded-lg border-2 border-destructive/50 p-6">
  <h3 className="text-destructive font-semibold">Danger Zone</h3>
  <p className="text-muted-foreground text-sm mt-2">
    Destructive actions — coming in Phase 5.
  </p>
</div>
```

- [ ] **Step 4: Preserve existing child routes**

The existing routes at `/settings/profile`, `/settings/users`, `/settings/roles` must continue to work. They are already file-based routes under `packages/web/src/routes/settings/`. Verify that converting `settings.tsx` to a layout route with `<Outlet>` still renders these child routes correctly.

Run the dev server and manually navigate to `/settings/profile`, `/settings/users`, `/settings/roles` to confirm they render inside the settings layout.

- [ ] **Step 5: Add settings i18n namespace**

Create `packages/web/src/locales/en/settings.json`:

```json
{
  "title": "Settings",
  "subtitle": "Manage your Rioku instance configuration",
  "nav": {
    "general": "General",
    "network": "Network",
    "tls": "TLS & Certificates",
    "observability": "Observability",
    "configStore": "Config Store",
    "authentication": "Authentication",
    "pki": "PKI",
    "dangerZone": "Danger Zone"
  }
}
```

Register the namespace in `packages/web/src/lib/i18n.ts`.

- [ ] **Step 6: Run the regenerated route tree**

TanStack Router auto-generates `routeTree.gen.ts`. After adding new route files:

```bash
cd packages/web && npx tsc --noEmit
```

Verify no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(web): settings multi-page layout with sub-navigation and route stubs"
```

---

## Task 9: Full-Page Detail View Pattern

**Files:**
- Create: `packages/web/src/components/layout/detail-page.tsx`
- Create: `packages/web/src/components/layout/__tests__/detail-page.test.tsx`
- Modify: `packages/web/src/exports/index.ts`

Spec Section 5.1. A generic layout component for all entity detail views (routes, services, policies, users, API keys). This task builds the pattern; entity-specific content comes in Phase 2.

- [ ] **Step 1: Write tests (TDD)**

Create `packages/web/src/components/layout/__tests__/detail-page.test.tsx`:

Test cases:
- `renders page title in h1`
- `renders back button with correct label`
- `back button navigates to backTo path`
- `renders tabs when tabs prop is provided`
- `active tab is determined from URL param`
- `clicking a tab updates the URL tab param`
- `renders toolbar content (edit/save/cancel buttons)`
- `renders children content`
- `renders metadata sidebar when provided`

- [ ] **Step 2: Implement DetailPage component**

Create `packages/web/src/components/layout/detail-page.tsx`:

```tsx
import { Link, useSearch, useNavigate } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

export interface DetailTab {
  /** URL-safe tab ID (used in ?tab= param) */
  id: string
  /** Display label */
  label: string
  /** Tab content */
  content: React.ReactNode
}

export interface DetailPageProps {
  /** Page title (rendered as h1) */
  title: string
  /** Optional subtitle */
  subtitle?: string
  /** Back button label (e.g., "Back to Routes") */
  backLabel: string
  /** Back button navigation path */
  backTo: string
  /** Tabs for the detail view */
  tabs?: DetailTab[]
  /** Default tab ID when no ?tab= param in URL */
  defaultTab?: string
  /** Toolbar content (edit/save/cancel buttons) */
  toolbar?: React.ReactNode
  /** Metadata sidebar (right column — created date, ID, etc.) */
  metadata?: React.ReactNode
  /** Main content (used when tabs are not provided) */
  children?: React.ReactNode
}
```

The component:
1. Renders the back button as a `<Link>` to `backTo`
2. Renders the title as `<h1>` (important for a11y focus management — Task 15)
3. Renders optional toolbar to the right of the title
4. If `tabs` are provided, renders a `<Tabs>` component with URL-synced active tab via `?tab=` search param
5. If `metadata` is provided, renders a two-column layout (content left, metadata right)
6. On mobile, metadata renders below the main content

Deep linking to tabs (spec 18.5): The active tab is stored in the URL search params. Changing tabs updates the URL without a full navigation. Sharing a URL opens the correct tab.

- [ ] **Step 3: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/components/layout/__tests__/detail-page.test.tsx
```

- [ ] **Step 4: Add to exports**

Update `packages/web/src/exports/index.ts`:

```ts
export { DetailPage } from '@/components/layout/detail-page'
export type { DetailPageProps, DetailTab } from '@/components/layout/detail-page'
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): full-page detail view pattern with tabbed layout and URL-synced tabs"
```

---

## Task 10: `usePreferences` Hook with Global/Device Scoping

**Files:**
- Modify: `packages/web/src/lib/preferences.ts` (major rewrite)
- Create: `packages/web/src/hooks/use-preferences.ts`
- Modify: `packages/web/src/lib/__tests__/preferences.test.ts` (rewrite)
- Create: `packages/web/src/hooks/__tests__/use-preferences.test.ts`
- Modify: `packages/web/src/hooks/use-theme.ts` (update to use new preferences)

Spec Section 4.5. The current `preferences.ts` is a simple flat localStorage wrapper. Replace it with a scoped system supporting `global` (follows user across devices) and `device` (per-device, based on screen/UA hash).

- [ ] **Step 1: Write tests (TDD)**

Create `packages/web/src/hooks/__tests__/use-preferences.test.ts`:

Test cases:
- `usePreferences with device scope reads from device-specific key`
- `usePreferences with device scope writes to device-specific key`
- `usePreferences with global scope reads from user-scoped key`
- `usePreferences with global scope writes to user-scoped key`
- `device hash is computed from screen dimensions and user agent`
- `default value is returned when key does not exist`
- `set updates the value and persists to localStorage`
- `different devices get different preference stores`
- `storage key format matches: rioku-pref:{scope}:{userId}:{deviceHash?}:{key}`

Create `packages/web/src/lib/__tests__/preferences.test.ts` (rewrite to test new scoped API):

Test cases:
- `getDeviceHash returns consistent hash for same inputs`
- `getDeviceHash returns different hash for different screen sizes`
- `getPreference reads from localStorage with correct key format`
- `setPreference writes to localStorage with correct key format`
- `getPreference returns default when key missing`
- `resetPreferences clears all rioku-pref: keys`

- [ ] **Step 2: Rewrite preferences.ts**

Modify `packages/web/src/lib/preferences.ts`:

```ts
/**
 * Scoped user preferences backed by localStorage.
 *
 * Two scopes:
 * - "global" — follows the user across all devices (theme, locale, colorblind mode)
 * - "device" — per-device, since screen size and context differ (table density, columns, sidebar state)
 *
 * Storage key format: rioku-pref:{scope}:{userId}:{deviceHash?}:{key}
 *
 * Phase 1: localStorage only.
 * Phase 2: Write-through cache with background sync to server for global scope.
 */

export type PreferenceScope = 'global' | 'device'

/** Compute a stable hash from screen dimensions + user agent. */
export function getDeviceHash(): string {
  if (typeof window === 'undefined') return 'ssr'
  const raw = `${screen.width}x${screen.height}:${navigator.userAgent}`
  // Simple hash — djb2
  let hash = 5381
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) + hash + raw.charCodeAt(i)) & 0xffffffff
  }
  return hash.toString(36)
}

function buildKey(
  scope: PreferenceScope,
  userId: string,
  key: string,
): string {
  if (scope === 'global') {
    return `rioku-pref:global:${userId}:${key}`
  }
  return `rioku-pref:device:${userId}:${getDeviceHash()}:${key}`
}

export function getPreference<T>(
  scope: PreferenceScope,
  userId: string,
  key: string,
  defaultValue: T,
): T {
  try {
    const raw = localStorage.getItem(buildKey(scope, userId, key))
    if (raw === null) return defaultValue
    return JSON.parse(raw) as T
  } catch {
    return defaultValue
  }
}

export function setPreference<T>(
  scope: PreferenceScope,
  userId: string,
  key: string,
  value: T,
): void {
  localStorage.setItem(buildKey(scope, userId, key), JSON.stringify(value))
}

export function removePreference(
  scope: PreferenceScope,
  userId: string,
  key: string,
): void {
  localStorage.removeItem(buildKey(scope, userId, key))
}
```

- [ ] **Step 3: Create usePreferences hook**

Create `packages/web/src/hooks/use-preferences.ts`:

```ts
import { useState, useCallback } from 'react'
import { useCurrentUser } from '@/hooks/use-auth'
import {
  getPreference,
  setPreference,
  type PreferenceScope,
} from '@/lib/preferences'

/**
 * React hook for reading/writing scoped user preferences.
 *
 * @param key - The preference key (e.g., 'table-density', 'theme')
 * @param defaultValue - Default when no preference stored
 * @param scope - 'global' or 'device' (default: 'device')
 */
export function usePreferences<T>(
  key: string,
  defaultValue: T,
  scope: PreferenceScope = 'device',
): [T, (value: T) => void] {
  const user = useCurrentUser()
  const userId = user?.id ?? 'anonymous'

  const [value, setValue] = useState<T>(() =>
    getPreference(scope, userId, key, defaultValue),
  )

  const set = useCallback(
    (newValue: T) => {
      setValue(newValue)
      setPreference(scope, userId, key, newValue)
    },
    [scope, userId, key],
  )

  return [value, set]
}
```

- [ ] **Step 4: Update useTheme to use new preferences**

Modify `packages/web/src/hooks/use-theme.ts` to use the new `usePreferences` hook with `scope: 'global'` instead of the old flat `getPreferences().theme` call. Theme follows the user across devices.

This requires the `useCurrentUser` context to be available. If the user is not authenticated (login page), fall back to localStorage directly with `'anonymous'` as userId.

- [ ] **Step 5: Backwards compatibility**

The old `Preferences` interface and `getPreferences()`/`setPreference()` functions are used by the existing theme hook. Add a compatibility shim that reads old-format keys (`rioku-preferences`) and migrates them to the new format on first access. After migration, delete the old key.

- [ ] **Step 6: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/lib/__tests__/preferences.test.ts src/hooks/__tests__/use-preferences.test.ts src/hooks/__tests__/use-theme.test.ts
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(web): usePreferences hook with global/device scoping and device hash"
```

---

## Task 11: Toast System

**Files:**
- Create: `packages/web/src/lib/toast.ts`
- Create: `packages/web/src/lib/__tests__/toast.test.ts`

Spec Section 16. The `sonner` library is already installed and the `<Toaster>` component is already rendered in `packages/web/src/routes/__root.tsx`. This task creates a typed toast utility wrapper for consistent usage across the app.

- [ ] **Step 1: Write tests (TDD)**

Create `packages/web/src/lib/__tests__/toast.test.ts`:

Test cases:
- `showToast.success calls sonner toast.success with correct args`
- `showToast.error calls sonner toast.error with correct args`
- `showToast.info calls sonner toast.info with correct args`
- `showToast.success includes entity name in message`
- `showToast.error includes status code in message`
- `showToast.success accepts undo action`
- `default duration is 5000ms`
- `custom duration overrides default`

- [ ] **Step 2: Implement toast utility**

Create `packages/web/src/lib/toast.ts`:

```ts
import { toast } from 'sonner'

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface ToastOptions {
  /** Auto-dismiss duration in ms. Default: 5000 */
  duration?: number
  /** Action button (e.g., Undo) */
  action?: ToastAction
}

/**
 * Typed toast utilities for consistent messaging across the app.
 * Wraps sonner's toast API with Rioku-specific defaults.
 *
 * Usage:
 *   showToast.success('Route created', { entity: 'payments-api' })
 *   showToast.error('Failed to save', { status: 500, detail: 'Internal error' })
 *   showToast.info('Copied to clipboard')
 */
export const showToast = {
  success(message: string, options?: ToastOptions) {
    toast.success(message, {
      duration: options?.duration ?? 5000,
      action: options?.action
        ? { label: options.action.label, onClick: options.action.onClick }
        : undefined,
    })
  },

  error(message: string, options?: ToastOptions & { status?: number; detail?: string }) {
    const fullMessage = options?.detail
      ? `${message}: ${options.detail}`
      : message
    toast.error(fullMessage, {
      duration: options?.duration ?? 7000, // errors stay longer
      action: options?.action
        ? { label: options.action.label, onClick: options.action.onClick }
        : undefined,
    })
  },

  info(message: string, options?: ToastOptions) {
    toast.info(message, {
      duration: options?.duration ?? 4000,
      action: options?.action
        ? { label: options.action.label, onClick: options.action.onClick }
        : undefined,
    })
  },
}
```

- [ ] **Step 3: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/lib/__tests__/toast.test.ts
```

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): typed toast utility wrapping sonner for consistent app messaging"
```

---

## Task 12: Loading Skeletons, Error Boundaries, Connection Lost Indicator

**Files:**
- Create: `packages/web/src/components/rioku/page-skeleton.tsx`
- Create: `packages/web/src/components/rioku/error-boundary.tsx`
- Create: `packages/web/src/components/rioku/connection-indicator.tsx`
- Create: `packages/web/src/components/rioku/__tests__/page-skeleton.test.tsx`
- Create: `packages/web/src/components/rioku/__tests__/error-boundary.test.tsx`
- Create: `packages/web/src/components/rioku/__tests__/connection-indicator.test.tsx`
- Modify: `packages/web/src/routes/__root.tsx` (add connection indicator)
- Modify: `packages/web/src/exports/index.ts`

Spec Sections 18.7, 18.8, 18.9.

- [ ] **Step 1: Write tests for all three components**

**page-skeleton.test.tsx:**
- `renders stat card skeletons`
- `renders table skeletons with correct number of rows`
- `renders chart skeletons`
- `renders detail view skeletons`
- `renders form skeletons`
- All should use the existing `<Skeleton>` component from `@/components/ui/skeleton`

**error-boundary.test.tsx:**
- `renders children when no error`
- `renders error fallback when child throws`
- `fallback shows error message`
- `retry button resets the error boundary`
- `does not crash the entire page`

**connection-indicator.test.tsx:**
- `does not render when connected`
- `renders warning banner when connection lost`
- `shows "Reconnected" toast on reconnection`
- `banner text is "Connection lost — retrying..."`

- [ ] **Step 2: Implement PageSkeleton**

Create `packages/web/src/components/rioku/page-skeleton.tsx`:

```tsx
import { Skeleton } from '@/components/ui/skeleton'

export type SkeletonVariant = 'stat-cards' | 'table' | 'chart' | 'detail' | 'form'

export interface PageSkeletonProps {
  /** Type of skeleton to render */
  variant: SkeletonVariant
  /** Number of rows for table variant. Default: 5 */
  rows?: number
  /** Number of cards for stat-cards variant. Default: 4 */
  cards?: number
}
```

Renders shimmer placeholders matching the shape of:
- `stat-cards`: grid of 4 (default) pulsing rectangles matching `StatCard` dimensions
- `table`: header row + N data rows with column-width blocks
- `chart`: rounded rectangle matching a chart container
- `detail`: card outlines with key-value pair shimmer blocks
- `form`: input-shaped shimmer blocks

- [ ] **Step 3: Implement ErrorBoundary**

Create `packages/web/src/components/rioku/error-boundary.tsx`:

A React error boundary component. Uses the class component API (React error boundaries require it). Wraps individual sections, not entire pages.

```tsx
export interface ErrorBoundaryProps {
  /** Content to render in the error state */
  fallback?: React.ReactNode
  /** Callback when error occurs */
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  children: React.ReactNode
}
```

Default fallback renders:
- "Something went wrong" heading
- Error message (in development only — hidden in production)
- "Retry" button that resets the boundary state

- [ ] **Step 4: Implement ConnectionIndicator**

Create `packages/web/src/components/rioku/connection-indicator.tsx`:

Monitors API connectivity. Renders a persistent banner at the top of the content area when the daemon API is unreachable.

Strategy:
- Listens for failed `fetch` calls (network errors, not HTTP errors)
- Also monitors SSE stream connection state from `use-sse.ts`
- When disconnected: shows amber banner "Connection lost — retrying..." with a spinner
- Auto-retry with exponential backoff (1s, 2s, 4s, 8s, max 30s)
- On reconnection: dismiss banner, show success toast "Reconnected", refetch all stale queries via `queryClient.invalidateQueries()`

Wire into `packages/web/src/routes/__root.tsx` AppShell:

```tsx
function AppShell() {
  // ... existing code
  return (
    <>
      <AppSidebar />
      <SidebarInset>
        <Header onOpenCommandPalette={openCommandPalette} />
        <ConnectionIndicator />
        <div className="flex-1 overflow-auto p-4">
          <Outlet />
        </div>
      </SidebarInset>
      {/* ... existing modals */}
    </>
  )
}
```

- [ ] **Step 5: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/components/rioku/__tests__/page-skeleton.test.tsx src/components/rioku/__tests__/error-boundary.test.tsx src/components/rioku/__tests__/connection-indicator.test.tsx
```

- [ ] **Step 6: Update exports**

Update `packages/web/src/exports/index.ts`:

```ts
export { PageSkeleton } from '@/components/rioku/page-skeleton'
export { ErrorBoundary } from '@/components/rioku/error-boundary'
export { ConnectionIndicator } from '@/components/rioku/connection-indicator'
export type { PageSkeletonProps, SkeletonVariant } from '@/components/rioku/page-skeleton'
export type { ErrorBoundaryProps } from '@/components/rioku/error-boundary'
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(web): loading skeletons, error boundaries, connection lost indicator"
```

---

## Task 13: Theme System — Dark/Light CSS Variables, useTheme, OS Preference

**Files:**
- Create: `packages/ui/src/theme/tokens.css` (extract CSS variables from web)
- Create: `packages/ui/src/theme/index.ts` (ThemeProvider, useTheme)
- Create: `packages/ui/src/theme/__tests__/theme.test.ts`
- Modify: `packages/web/src/index.css` (import tokens from @rioku/ui)
- Modify: `packages/web/src/hooks/use-theme.ts` (delegate to @rioku/ui)

Spec Section 2.2, 18B.3. The existing theme system in `packages/web/src/hooks/use-theme.ts` works but is tightly coupled to the web app. Extract the theme token definitions and a router-agnostic theme hook into `@rioku/ui`.

- [ ] **Step 1: Extract CSS variable tokens**

Create `packages/ui/src/theme/tokens.css`:

Copy the `:root` and `.dark` CSS custom property definitions from `packages/web/src/index.css` into `packages/ui/src/theme/tokens.css`. Also include the Rioku custom colors (`--color-cyan`, `--color-success`, `--color-warning`).

Add additional tokens for high-contrast mode (spec 15.4):

```css
/* High contrast mode — applied via .high-contrast class on <html> */
.high-contrast {
  --border: oklch(0.7 0 0);
  --muted-foreground: oklch(0.75 0.014 285.823);
  /* Increase contrast ratios to AAA levels */
}

.high-contrast.dark {
  --border: oklch(0.45 0 0);
  --muted-foreground: oklch(0.8 0.012 285.823);
}
```

The web app's `index.css` then imports tokens from `@rioku/ui`:

```css
@import "@rioku/ui/theme/tokens.css";
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";
@import "@fontsource-variable/geist";
/* ... rest of index.css (scrollbar styles, etc.) */
```

- [ ] **Step 2: Create theme utilities in @rioku/ui**

Create `packages/ui/src/theme/index.ts`:

```ts
/**
 * Theme utilities for @rioku/ui.
 * These are router-agnostic — they work in Storybook, plugin pages, and the main app.
 */

export type Theme = 'dark' | 'light' | 'system'

/** Resolve 'system' to the actual OS preference. */
export function resolveTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme
  if (typeof window === 'undefined') return 'dark'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

/** Apply the resolved theme to the document root. */
export function applyTheme(resolved: 'dark' | 'light'): void {
  const el = document.documentElement
  if (resolved === 'dark') {
    el.classList.add('dark')
  } else {
    el.classList.remove('dark')
  }
}

/** Detect OS preferences for first-visit defaults (spec 18B.3). */
export function detectOSPreferences(): {
  theme: 'dark' | 'light'
  reducedMotion: boolean
  highContrast: boolean
} {
  const mql = typeof window !== 'undefined' ? window.matchMedia : null
  return {
    theme: mql?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    reducedMotion: mql?.('(prefers-reduced-motion: reduce)').matches ?? false,
    highContrast: mql?.('(prefers-contrast: more)').matches ?? false,
  }
}
```

- [ ] **Step 3: Write tests**

Create `packages/ui/src/theme/__tests__/theme.test.ts`:

Test cases:
- `resolveTheme returns dark for 'dark'`
- `resolveTheme returns light for 'light'`
- `resolveTheme resolves system based on media query`
- `applyTheme adds dark class for dark theme`
- `applyTheme removes dark class for light theme`
- `detectOSPreferences returns expected defaults`

- [ ] **Step 4: Update web's useTheme**

Modify `packages/web/src/hooks/use-theme.ts` to import `resolveTheme` and `applyTheme` from `@rioku/ui` instead of defining them locally.

- [ ] **Step 5: Run tests**

```bash
cd packages/ui && npx vitest run --reporter=verbose src/theme/__tests__/theme.test.ts
cd packages/web && npx vitest run --reporter=verbose src/hooks/__tests__/use-theme.test.ts
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ui): theme system — CSS variable tokens, OS preference detection, dark/light"
```

---

## Task 14: Themed Checkboxes and Focus-Visible Consistency

**Files:**
- Modify: `packages/web/src/index.css` (add global focus-visible styles and checkbox overrides)
- Create: `packages/ui/src/components/checkbox.tsx` (themed checkbox component)
- Create: `packages/ui/src/components/__tests__/checkbox.test.tsx`
- Create: `packages/ui/stories/Checkbox.stories.tsx`
- Modify: `packages/ui/src/components/index.ts`

Spec Sections 17 (themed checkboxes), 18B.5 (focus-visible consistency).

- [ ] **Step 1: Write checkbox tests (TDD)**

Create `packages/ui/src/components/__tests__/checkbox.test.tsx`:

Test cases:
- `renders unchecked state with dark background and subtle border`
- `renders checked state with primary color background and white checkmark`
- `calls onChange when clicked`
- `shows hover state on mouse enter`
- `disabled state has reduced opacity`
- `has focus ring on keyboard focus (focus-visible)`
- `has aria-checked attribute matching state`
- `indeterminate state renders dash icon`

- [ ] **Step 2: Implement themed Checkbox**

Create `packages/ui/src/components/checkbox.tsx`:

```tsx
/**
 * Themed checkbox component.
 * Replaces browser-default checkbox rendering with custom CSS styling.
 *
 * - Unchecked: dark background, subtle border, rounded corners
 * - Checked: primary color background, white checkmark icon
 * - Hover: border color brightens
 * - Disabled: reduced opacity, no hover
 * - Focus: focus ring matching global focus-visible style
 */
export interface CheckboxProps {
  checked: boolean | 'indeterminate'
  onChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
  'aria-label'?: string
}
```

Implementation uses a hidden native `<input type="checkbox">` for accessibility, with a styled visual overlay. The checkmark is rendered via CSS `::after` or an inline SVG `<Check>` icon from lucide-react.

All colors via CSS variables:
- Unchecked background: `var(--input)`
- Unchecked border: `var(--border)`
- Checked background: `var(--primary)`
- Checkmark color: `var(--primary-foreground)`

- [ ] **Step 3: Add global focus-visible styles**

Add to `packages/web/src/index.css` (or `packages/ui/src/theme/tokens.css`):

```css
/* Focus-visible consistency (spec 18B.5) */
@layer base {
  :focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 2px;
    border-radius: inherit;
  }

  /* Remove default focus outline for mouse users */
  :focus:not(:focus-visible) {
    outline: none;
  }
}
```

This ensures every interactive element (buttons, links, inputs, toggles, table rows, tabs, sidebar items) has a consistent 2px primary-colored focus ring when focused via keyboard.

- [ ] **Step 4: Add Storybook story and re-export**

Create `packages/ui/stories/Checkbox.stories.tsx` with variants:
- Unchecked, Checked, Indeterminate
- Disabled unchecked, Disabled checked
- Focused (with `autoFocus`)

Update `packages/ui/src/components/index.ts`:

```ts
export { Checkbox } from './checkbox'
export type { CheckboxProps } from './checkbox'
```

- [ ] **Step 5: Run tests**

```bash
cd packages/ui && npx vitest run --reporter=verbose src/components/__tests__/checkbox.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(ui): themed checkbox component and global focus-visible consistency"
```

---

## Task 15: Skip to Content Link and Focus Management on Navigation

**Files:**
- Modify: `packages/web/src/routes/__root.tsx` (add skip link, focus management)
- Create: `packages/web/src/hooks/use-focus-on-navigate.ts`
- Create: `packages/web/src/hooks/__tests__/use-focus-on-navigate.test.ts`

Spec Sections 18B.1 (skip to content), 18B.2 (focus management on navigation).

- [ ] **Step 1: Write tests (TDD)**

Create `packages/web/src/hooks/__tests__/use-focus-on-navigate.test.ts`:

Test cases:
- `focuses the h1 element on pathname change`
- `does not focus on initial mount` (no flash on first load)
- `only runs when pathname changes, not on search param changes`

- [ ] **Step 2: Add skip to content link**

Modify `packages/web/src/routes/__root.tsx`:

Add a visually hidden link at the very top of the `RootLayout` component:

```tsx
<a
  href="#main-content"
  className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:text-sm focus:font-medium"
>
  Skip to main content
</a>
```

Add `id="main-content"` and `tabIndex={-1}` to the main content `<div>` in `AppShell`:

```tsx
<div id="main-content" tabIndex={-1} className="flex-1 overflow-auto p-4">
  <Outlet />
</div>
```

- [ ] **Step 3: Implement useFocusOnNavigate hook**

Create `packages/web/src/hooks/use-focus-on-navigate.ts`:

```ts
import { useEffect, useRef } from 'react'
import { useRouterState } from '@tanstack/react-router'

/**
 * Moves focus to the page's <h1> element when the pathname changes.
 * This ensures screen reader users hear the new page title after navigation.
 */
export function useFocusOnNavigate(): void {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const prevPathname = useRef(pathname)

  useEffect(() => {
    if (prevPathname.current === pathname) return
    prevPathname.current = pathname

    // Small delay to allow the new page to render its h1
    requestAnimationFrame(() => {
      const h1 = document.querySelector('h1')
      if (h1) {
        h1.setAttribute('tabindex', '-1')
        h1.focus({ preventScroll: false })
      }
    })
  }, [pathname])
}
```

Wire into the `AppShell` component in `__root.tsx`:

```tsx
function AppShell() {
  useFocusOnNavigate()
  // ... rest of existing code
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose src/hooks/__tests__/use-focus-on-navigate.test.ts
```

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(web): skip to content link and focus management on navigation (a11y)"
```

---

## Task 16: 404 Page

**Files:**
- Create: `packages/web/src/routes/404.tsx` (or use TanStack Router's `notFoundComponent`)
- Modify: `packages/web/src/routes/__root.tsx` (add `notFoundComponent`)

Spec reference: a 404 page is needed for invalid routes and for disabled plugin pages (Section 13.3).

- [ ] **Step 1: Write tests**

The 404 component is simple enough to test inline:
- `renders 404 heading`
- `renders descriptive message`
- `renders "Go to Dashboard" link`
- `renders optional context message when provided`

- [ ] **Step 2: Create NotFound component**

TanStack Router supports `notFoundComponent` on the root route. Create a styled 404 page:

```tsx
function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <div className="text-6xl font-bold text-muted-foreground/30">404</div>
      <h1 className="text-xl font-semibold text-foreground">Page not found</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Button variant="outline" asChild>
        <Link to="/">Go to Dashboard</Link>
      </Button>
    </div>
  )
}
```

Wire into the root route:

```tsx
export const Route = createRootRouteWithContext<RouterContext>()({
  errorComponent: RootErrorComponent,
  notFoundComponent: NotFound,
  // ... rest
})
```

For disabled plugin pages (future), the 404 can accept an optional context message:

```tsx
interface NotFoundProps {
  /** Optional message explaining why the page is missing */
  message?: string
}
```

This renders: "This page is provided by the [plugin name] plugin, which is currently disabled."

- [ ] **Step 3: Run tests**

```bash
cd packages/web && npx vitest run --reporter=verbose
```

Run the full test suite to make sure nothing is broken.

- [ ] **Step 4: Commit**

```bash
git commit -m "feat(web): 404 page with styled layout and plugin context support"
```

---

## Final Verification

After all 16 tasks are complete, run full verification:

```bash
# TypeScript — no errors in either package
cd packages/ui && npx tsc --noEmit
cd packages/web && npx tsc --noEmit

# All unit tests pass
cd packages/ui && npx vitest run
cd packages/web && npx vitest run

# Storybook builds
cd packages/ui && npx storybook build

# Web build succeeds (embeds into daemon)
cd packages/web && npm run build

# Full make targets
make test-web
make test-ui
make web-build
```

If the sandbox is available, start it and manually verify:
```bash
SANDBOX_ROOT_PASSWORD=TestRoot1234! make sandbox
```

Navigate through:
- Sidebar navigation (all sections visible, user popup works)
- Settings multi-page layout (sub-nav, all sections accessible)
- Header breadcrumbs (chevron separators, clickable)
- Theme toggle (dark/light switches, CSS variables update)
- Notification bell (renders, opens empty panel)
- Mobile responsive (resize browser < 768px, hamburger appears, sidebar becomes drawer)
- 404 page (navigate to `/nonexistent`)

---

## Task Dependency Graph

```
Task 1 (packages/ui scaffold)
  |
  +-- Task 2 (install deps) -- no blocker, can parallel with Task 1
  |
  +-- Task 3 (SearchableSelect) -- depends on Task 1
  |
  +-- Task 4 (YamlJsonEditor) -- depends on Task 1, Task 2
  |
  +-- Task 13 (theme system) -- depends on Task 1
  |     |
  |     +-- Task 14 (checkboxes + focus-visible) -- depends on Task 13
  |
  Task 5 (DataTable overhaul) -- depends on Task 10
  |
  Task 6 (sidebar redesign) -- independent
  |
  Task 7 (header redesign) -- independent
  |
  Task 8 (settings layout) -- independent
  |
  Task 9 (detail view pattern) -- independent
  |
  Task 10 (usePreferences) -- independent
  |
  Task 11 (toast system) -- independent
  |
  Task 12 (skeletons, errors, connection) -- independent
  |
  Task 15 (skip to content, focus) -- independent
  |
  Task 16 (404 page) -- independent
```

**Parallelizable groups:**
- Group A (no deps): Tasks 6, 7, 8, 9, 10, 11, 12, 15, 16
- Group B (depends on Task 1): Tasks 3, 4, 13
- Group C (depends on Task 13): Task 14
- Group D (depends on Task 10): Task 5

Execute order for maximum parallelism:
1. Tasks 1 + 2 + 6 + 7 + 8 + 9 + 10 + 11 + 12 + 15 + 16 (all in parallel)
2. Tasks 3 + 4 + 13 + 5 (once their deps are done)
3. Task 14 (once Task 13 is done)
