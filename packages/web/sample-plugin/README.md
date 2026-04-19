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
../node_modules/.bin/vite build
```

Output: `dist/plugin.mjs` — externalises every entry in `REQUIRED_EXTERNALS`.

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
