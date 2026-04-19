# sample-plugin

Dev-only reference plugin that exercises every SDK surface the admin host
exposes. Its sole consumer is the E2E dev-sideload smoke test (Task 1f.123) —
CI builds this bundle and the Playwright spec loads it via
`?plugin=/sample-plugin/dist/plugin.mjs`.

## Registered surfaces

| Surface     | Identifier                        | Notes                               |
| ----------- | --------------------------------- | ----------------------------------- |
| Route       | `/plugins/hello`                  | Rendered via the `/plugins/$` catch-all. |
| Sidebar     | group `plugins`, label "Hello Plugin" | Linked to `/plugins/hello`.     |
| Widget type | `com.example.hello:greeter`       | Marker widget (no data binding).    |
| Theme       | `sample-hello-theme`              | Teal-accented dark override.        |
| Permission  | `com.example.hello:greet`         | `default_roles: []` — no grants.    |
| Spotlight   | `sample-hello-open`               | Opens the hello route.              |

## Build

```
cd packages/web/sample-plugin
pnpm build
```

Output: `dist/plugin.mjs` — externalises every entry in `REQUIRED_EXTERNALS`.

## Host-provided dependencies

This plugin relies on its host providing the packages listed in
`REQUIRED_EXTERNALS` (React, React-DOM, Mantine core/hooks, Tabler icons,
TanStack Router). Those are declared as `peerDependencies` in this package's
`package.json`, and inside the monorepo they resolve from the parent
`packages/web/node_modules`. A plugin copied outside the monorepo must be
consumed by a host that supplies compatible versions at runtime via an import
map.

The `@rioku/plugin-sdk` specifier used in `src/plugin.tsx` is not a real
workspace package yet — it is a typed re-export surface served from
`packages/web/src/host/sdk.ts` via a tsconfig/vite path alias. Once the SDK is
extracted as its own package it will appear in `peerDependencies` too.

## Layout

```
sample-plugin/
  rioku-plugin.json   # manifest (stage-1 loader accepts JSON only)
  vite.config.ts      # lib build with REQUIRED_EXTERNALS
  tsconfig.json       # isolated TS project referencing host SDK types
  src/
    plugin.tsx        # default export: registers contributions
    hello-page.tsx    # route component
    hello-widget.tsx  # widget component
```
