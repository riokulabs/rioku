/**
 * <InstalledPluginDetail> — drawer content for an installed plugin.
 *
 * Sections:
 *   - Identity header (name, slug, version, parts)
 *   - Declared permissions (green = registered, red dot = unknown)
 *   - Audit tail (last 10 entries)
 *   - Settings deep link
 *   - Enable/Disable + Uninstall actions
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Stack,
  Table,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCircleCheck,
  IconExternalLink,
  IconPlug,
} from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import dayjs from 'dayjs';
import { notify } from '@/hooks/use-notify';
import { usePermissionsCatalog } from '@/hooks/use-permissions-catalog';
import { PART_COLORS } from '../../shared/constants';
import {
  useInstalledPlugin,
  usePluginAuditTail,
  enablePlugin,
  disablePlugin,
} from '../api';

interface InstalledPluginDetailProps {
  pluginId: string;
  tenantSlug: string;
  onUninstall: () => void;
  onClose: () => void;
}

export function InstalledPluginDetail({
  pluginId,
  tenantSlug,
  onUninstall,
  onClose,
}: InstalledPluginDetailProps) {
  const plugin = useInstalledPlugin(pluginId);
  const auditTail = usePluginAuditTail(pluginId, 10);
  const { all: allPerms } = usePermissionsCatalog();

  const [actionLoading, setActionLoading] = useState(false);

  if (!plugin) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
        Plugin not found. It may have been uninstalled.
      </Alert>
    );
  }

  const registeredKeys = new Set(allPerms.map((p) => p.key));

  async function handleToggle() {
    if (!plugin) return;
    setActionLoading(true);
    try {
      if (plugin.enabled) {
        await disablePlugin(plugin.id);
        notify.info('Plugin disabled', `${plugin.display_name} is now inactive.`);
      } else {
        await enablePlugin(plugin.id);
        notify.success('Plugin enabled', `${plugin.display_name} is now active.`);
      }
    } catch {
      notify.error('Failed to toggle plugin', 'Please try again.');
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <Stack gap="md">
      {/* Identity header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconPlug size={28} color="var(--mantine-color-violet-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4}>{plugin.display_name}</Title>
              {plugin.has_errors && (
                <Badge color="red" size="sm" variant="light">
                  has errors
                </Badge>
              )}
              <Badge color={plugin.enabled ? 'green' : 'gray'} size="sm" variant="light">
                {plugin.enabled ? 'enabled' : 'disabled'}
              </Badge>
            </Group>
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {plugin.slug} · v{plugin.version}
            </Text>
            <Group gap={4} mt={4}>
              {plugin.parts.map((part) => (
                <Badge
                  key={part}
                  size="xs"
                  color={PART_COLORS[part]}
                  variant="light"
                >
                  {part}
                </Badge>
              ))}
            </Group>
          </Stack>
        </Group>
        <Button size="xs" variant="default" onClick={onClose}>
          Close
        </Button>
      </Group>

      {plugin.has_errors && (
        <Alert
          icon={<IconAlertTriangle size={16} />}
          color="red"
          variant="light"
          title="Plugin has errors"
        >
          This plugin failed to load cleanly. Disable it and check logs before re-enabling.
        </Alert>
      )}

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button
          size="sm"
          variant="light"
          color={plugin.enabled ? 'orange' : 'green'}
          loading={actionLoading}
          disabled={plugin.has_errors && !plugin.enabled}
          onClick={() => void handleToggle()}
        >
          {plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
        </Button>
        <Button
          size="sm"
          variant="light"
          leftSection={<IconExternalLink size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/settings"
          params={{ tenant: tenantSlug }}
          search={{ section: 'plugins', plugin: plugin.slug }}
        >
          Settings
        </Button>
        <Button
          size="sm"
          variant="subtle"
          color="red"
          onClick={onUninstall}
        >
          Uninstall…
        </Button>
      </Group>

      <Divider />

      {/* Declared permissions */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Declared permissions
        </Text>
        {plugin.declared_permissions.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No permissions declared.
          </Text>
        ) : (
          <Stack gap={4}>
            {plugin.declared_permissions.map((perm) => {
              const known = registeredKeys.has(perm);
              return (
                <Group key={perm} gap="xs" wrap="nowrap">
                  {known ? (
                    <IconCircleCheck size={14} color="var(--mantine-color-green-6)" />
                  ) : (
                    <IconAlertCircle size={14} color="var(--mantine-color-red-6)" />
                  )}
                  <Code
                    c={known ? 'var(--mantine-color-green-7)' : 'var(--mantine-color-red-7)'}
                  >
                    {perm}
                  </Code>
                  {!known && (
                    <Text size="xs" c="var(--mantine-color-gray-7)">
                      (unknown — not in catalog)
                    </Text>
                  )}
                </Group>
              );
            })}
          </Stack>
        )}
      </Stack>

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent audit activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this plugin yet.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Action</Table.Th>
                <Table.Th>Actor</Table.Th>
                <Table.Th>When</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditTail.map((entry) => (
                <Table.Tr key={entry.id}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {entry.action}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{entry.actor_id}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{dayjs(entry.at).format('MMM D, HH:mm:ss')}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Stack>
  );
}
