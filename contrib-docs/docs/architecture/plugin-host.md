---
title: Plugin Host
description: How the admin SPA loads, validates, and manages plugin contributions at runtime
sidebar_position: 4
---

The plugin host is the TypeScript runtime inside the admin SPA that allows third-party plugins to contribute UI surfaces: sidebar entries, routes, zones, themes, spotlight commands, widgets, settings panels, and API endpoints. It is not an OS-level process — it runs entirely in the browser alongside the SPA.

```mermaid
flowchart TD
    subgraph spa["Admin SPA (browser)"]
        subgraph host["Plugin host (packages/web/src/host/)"]
            Loader["plugin-loader.ts<br/>(loadPluginFromUrl / loadDevPluginSideload)"]
            Validator["manifest-validator.ts<br/>(schema + ABI check)"]
            Registry["plugin-registry.ts<br/>(Zustand store)"]
            Perms["permissions.ts<br/>(permission registry + role resolver)"]
            Surfaces["Surface registries<br/>(zones / routes / sidebar /<br/>themes / spotlight / widgets /<br/>settings / api-endpoints)"]
        end

        Router["TanStack Router<br/>(routeTree.gen.ts)"]
        UI["Mantine components"]
    end

    subgraph daemon["rioku daemon"]
        PluginAPI["REST: /api/v1/t/{tenant}/plugins"]
        SideloadAPI["REST: /api/v1/t/{tenant}/plugins/sideload"]
    end

    subgraph plugin_prod["Production plugin (remote ESM)"]
        ProdManifest["manifest.json"]
        ProdBundle["admin.js (ESM)"]
    end

    subgraph plugin_dev["Dev plugin (localhost ESM)"]
        DevManifest["manifest.json (localhost)"]
        DevBundle["admin.js (Vite dev server)"]
    end

    %% Production load path
    PluginAPI -- "installed plugin list" --> Loader
    Loader -- "fetch" --> ProdManifest
    ProdManifest --> Validator
    Validator -- "ABI ok" --> Loader
    Loader -- "dynamic import()" --> ProdBundle
    ProdBundle -- "contributes to" --> Surfaces

    %% Dev sideload path (dev-mode gate enforced)
    SideloadAPI -- "sideload URL" --> Loader
    Loader -- "loadDevPluginSideload (skips manifest fetch)" --> DevBundle
    DevBundle -- "contributes to" --> Surfaces

    %% Registry + permissions
    Loader -- "registerPlugin / trackContribution" --> Registry
    Loader -- "registerPermission" --> Perms
    Perms -- "role-based checks" --> UI

    %% Surface → SPA
    Surfaces --> Router
    Surfaces --> UI
```

**Load paths:**

| Path | Function | When used |
| --- | --- | --- |
| Production | `loadPluginFromUrl(manifestUrl)` | Installed plugins fetched from their hosted manifest URLs |
| Dev sideload | `loadDevPluginSideload(...)` | Localhost plugins injected via the sideload API; requires dev-mode gate to be active |
| Sandboxed (stub) | `loadSandboxedPlugin(manifestUrl)` | iframe isolation mode; creates the iframe and logs a postMessage handshake. Actual sandbox RPC is not yet implemented. |

**Contribution surfaces a plugin can register:**

- `zones`: named render zones in the SPA shell
- `routes`: additional TanStack Router routes
- `sidebar`: sidebar navigation entries
- `themes`: Mantine theme overrides
- `spotlight`: command palette entries
- `widgets`: dashboard widget types
- `settings`: settings panel pages
- `apiEndpoints`: additional REST endpoint declarations
- `permissions`: new permission strings added to the permission registry

**Unload** calls the unregister function for every tracked contribution, then removes the plugin from the registry. The surface registries are the authoritative rendering stores; the plugin registry is purely accounting.

**Dev-mode gate:** the sideload API is only reachable when the daemon is running with the dev-mode capability enabled. Production deployments reject sideload requests at the REST layer.

**Source files:**

- `packages/web/src/host/plugin-loader.ts`: load, validate, contribute, unload
- `packages/web/src/host/manifest-validator.ts`: JSON schema + ABI compatibility check
- `packages/web/src/host/plugin-registry.ts`: Zustand store tracking installed plugins
- `packages/web/src/host/permissions.ts`: permission registry + role-based resolution
- `packages/web/src/host/sidebar.ts`, `routes.ts`, `themes.ts`, `spotlight.ts`, `widgets.ts`, `zones.ts`: per-surface registries
- `packages/daemon/internal/gateway/plugins_routes.go`: daemon-side plugin REST API
