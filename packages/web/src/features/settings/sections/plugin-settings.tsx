/**
 * <PluginSettingsSection> — Settings › Plugins
 *
 * Lists all installed plugins and lets the user open a per-plugin settings
 * drawer.  Each plugin may contribute a settings panel via the Zone primitive
 * (Task 1f.105 / Plan 1) using the zone-id pattern:
 *
 *   plugin-settings.<plugin-slug>
 *
 * Example registration in a plugin:
 *   host.zones.register({
 *     zone: 'plugin-settings.com.example.demo',
 *     component: DemoSettingsPanel,
 *     source: 'plugin',
 *     pluginName: 'com.example.demo',
 *   })
 *
 * Approach choice — Zone vs SettingsPanel registry
 * ──────────────────────────────────────────────────
 * The plan explicitly says "zone-backed" and the Zone primitive (§9.5.1) is
 * the correct extension point for per-plugin UI injection. The existing
 * `host.settings.register` / `registerSettingsPanel` registry is a separate
 * mechanism (spec §9.5.4) intended for global first-party settings panels
 * (profile, tenant, …); using it here would couple the plugin list to a
 * different registry that has no concept of "per-plugin" grouping. Zones,
 * keyed by `plugin-settings.<slug>`, give each plugin its own isolated slot
 * and map cleanly onto the existing Zone primitive without duplication.
 *
 * Permission: plugin:read (existing — no new permissions required).
 *
 * Task 8c.12
 */

import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Drawer,
  Group,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconLock,
  IconPlug,
  IconSettings,
} from '@tabler/icons-react';
import { EmptyState } from '@/components/empty-state';
import { Zone } from '@/components/zone';
import { usePermission } from '@/hooks/use-permission';
import { useMockStore } from '@/api/mock-store';
import type { Plugin } from '@/api/resources/types';

// ─── Plugin list selector ─────────────────────────────────────────────────────

/**
 * Returns all installed plugins from the mock store as a stable array.
 * Selector reads the record map; array is derived outside the selector to
 * avoid the Zustand "snapshot changed every render" trap.
 */
function useAllPlugins(): Plugin[] {
  const pluginsById = useMockStore((s) => s.plugins);
  return Object.values(pluginsById);
}

// ─── Plugin row ───────────────────────────────────────────────────────────────

interface PluginRowProps {
  plugin: Plugin;
  onConfigure: (plugin: Plugin) => void;
}

function PluginRow({ plugin, onConfigure }: PluginRowProps) {
  return (
    <Group
      justify="space-between"
      p="sm"
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
      data-testid={`plugin-settings-row-${plugin.slug}`}
    >
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" fw={500} style={{ flexShrink: 0 }}>
            {plugin.display_name}
          </Text>
          <Badge
            size="xs"
            color={plugin.enabled ? 'green' : 'gray'}
            variant="light"
          >
            {plugin.enabled ? 'enabled' : 'disabled'}
          </Badge>
          {plugin.has_errors && (
            <Badge size="xs" color="red" variant="light">
              errors
            </Badge>
          )}
        </Group>
        <Group gap="sm">
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {plugin.slug}
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            v{plugin.version}
          </Text>
        </Group>
      </Stack>

      <Tooltip label={`Configure ${plugin.display_name}`} withArrow>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconSettings size={14} />}
          onClick={() => { onConfigure(plugin); }}
          data-testid={`plugin-settings-configure-${plugin.slug}`}
        >
          Configure
        </Button>
      </Tooltip>
    </Group>
  );
}

// ─── Settings drawer ──────────────────────────────────────────────────────────

interface PluginSettingsDrawerProps {
  plugin: Plugin | null;
  onClose: () => void;
}

function PluginSettingsDrawer({ plugin, onClose }: PluginSettingsDrawerProps) {
  return (
    <Drawer
      opened={plugin !== null}
      onClose={onClose}
      title={
        plugin ? (
          <Group gap="xs">
            <Text fw={600}>{plugin.display_name}</Text>
            <Text size="sm" c="var(--mantine-color-gray-7)" ff="monospace">
              {plugin.version}
            </Text>
          </Group>
        ) : null
      }
      position="right"
      size="md"
      // transitionProps={{ duration: 0 }} — JSDOM does not run CSS transitions,
      // so duration:0 prevents the drawer from staying in a half-open state
      // during tests.  Keep this on all Drawers rendered under vitest.
      transitionProps={{ duration: 0 }}
      data-testid="plugin-settings-drawer"
    >
      {plugin && (
        <Stack gap="md" p="xs">
          <Title order={5}>Plugin settings</Title>
          <Zone
            id={`plugin-settings.${plugin.slug}`}
            fallback={
              <EmptyState
                icon={IconSettings}
                title="No settings"
                description="This plugin has not declared a settings panel."
              />
            }
          />
        </Stack>
      )}
    </Drawer>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function PluginSettingsSection() {
  const canRead = usePermission('plugin:read');
  const plugins = useAllPlugins();
  const [selected, setSelected] = useState<Plugin | null>(null);

  if (!canRead) {
    return (
      <Alert
        icon={<IconLock size={16} />}
        color="orange"
        variant="light"
        title="Access denied"
        data-testid="plugin-settings-access-denied"
      >
        You need the <strong>plugin:read</strong> permission to view plugin
        settings.
      </Alert>
    );
  }

  if (plugins.length === 0) {
    return (
      <EmptyState
        icon={IconPlug}
        title="No plugins installed"
        description="Install a plugin from the Marketplace or by reference to configure it here."
      />
    );
  }

  return (
    <>
      <Stack gap="sm" data-testid="plugin-settings-section">
        {plugins.map((plugin) => (
          <PluginRow
            key={plugin.id}
            plugin={plugin}
            onConfigure={setSelected}
          />
        ))}
      </Stack>

      <PluginSettingsDrawer
        plugin={selected}
        onClose={() => { setSelected(null); }}
      />
    </>
  );
}
