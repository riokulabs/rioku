/**
 * Sample plugin — registers one contribution per SDK surface.
 *
 * Exercised by Task 1f.123's E2E test: the `?plugin=` query-param sideload
 * loads this bundle and asserts each surface is visible in the UI.
 *
 * Permission escalation is explicitly NOT requested — `default_roles: []`
 * means the permission is declared but granted to no roles by default.
 */
import type { RiokuHost } from '@rioku/plugin-sdk';

import { HelloPage } from './hello-page';
import { HelloWidget } from './hello-widget';

const PLUGIN_NAME = 'sample-plugin';
const HELLO_ROUTE = '/plugins/hello';

// A tiny inline icon component so we don't pull a new Tabler icon into the bundle.
// Vite externalises `@tabler/icons-react`, but we also want the plugin to work
// without requiring any specific icon — a purely SVG component is sufficient.
function HelloIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12h18" />
      <path d="M12 3v18" />
    </svg>
  );
}

/** The plugin host calls this with a frozen `RiokuHost` object. */
export default function register(host: RiokuHost): void {
  // Surface 1 — route under the catch-all /plugins/* renderer.
  host.routes.register({
    path: HELLO_ROUTE,
    component: HelloPage,
    source: 'plugin',
    pluginName: PLUGIN_NAME,
  });

  // Surface 2 — sidebar entry (the sidebar renders `entry.path` directly, so
  // pointing at /plugins/hello takes the user through the catch-all route).
  host.sidebar.register({
    group: 'plugins',
    label: 'Hello Plugin',
    icon: HelloIcon,
    path: HELLO_ROUTE,
    source: 'plugin',
    pluginName: PLUGIN_NAME,
  });

  // Surface 3 — widget type (rendered by any widget grid that references the id).
  host.widgets.register({
    type: 'com.example.hello:greeter',
    displayName: 'Hello Greeter',
    schema: { input: {}, config: {} },
    component: HelloWidget,
    source: 'plugin',
    pluginName: PLUGIN_NAME,
  });

  // Surface 4 — theme (registered as teal-accented dark Mantine override).
  host.themes.register({
    name: 'sample-hello-theme',
    displayName: 'Sample Hello',
    colorScheme: 'dark',
    theme: { primaryColor: 'teal' },
    source: 'plugin',
  });

  // Surface 5 — permission. `default_roles: []` — no privilege escalation.
  host.permissions.register({
    key: 'com.example.hello:greet',
    description: 'Allow the sample plugin to greet the user',
    source: 'plugin-manifest',
    default_roles: [],
  });

  // Surface 6 — spotlight command.
  host.spotlight.registerCommand({
    id: 'sample-hello-open',
    label: 'Open Hello Plugin',
    keywords: ['hello', 'sample', 'plugin'],
    group: 'Plugins',
    source: 'plugin',
    pluginName: PLUGIN_NAME,
    onAction: () => {
      // Navigate via the browser history — plugin code cannot easily call the
      // router imperatively without additional plumbing, and this is sufficient
      // for the E2E smoke assertion on command visibility.
      if (typeof window !== 'undefined') {
        window.location.assign(HELLO_ROUTE);
      }
    },
  });
}
