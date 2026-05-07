/**
 * <InstalledPluginDetail> — drawer content for an installed plugin.
 *
 * Sections:
 *   - Identity header (name, slug, version, parts, signer chip)
 *   - Declared permissions (green = registered, red dot = unknown)
 *   - Build log (collapsible; only rendered when last_build_log is set)
 *   - Audit tail (last 10 entries)
 *   - Settings deep link
 *   - Enable/Disable + Uninstall actions
 *
 * Plan 6 (Task 6b.5) additions:
 *   - Signer chip that surfaces verified / revoked / pending status plus the
 *     first 8 chars of the signer fingerprint. Clicking the chip opens an
 *     inline <SignerDetailBadge>. Unsigned plugins show an orange "Unsigned"
 *     badge.
 *   - Build log section renders `plugin.last_build_log` inside a monospace
 *     box with a copy button. Used primarily for failed installs but the
 *     seeded broken plugin also exposes one for visual QA.
 */
import { useState } from 'react';
import {
  Accordion,
  ActionIcon,
  Alert,
  Badge,
  Button,
  Code,
  CopyButton,
  Divider,
  Group,
  HoverCard,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconCopy,
  IconExternalLink,
  IconFileText,
  IconPlug,
  IconShieldLock,
} from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import dayjs from 'dayjs';
import { notify } from '@/hooks/use-notify';
import { StatusBadge } from '@/components/status-badge';
import { usePermissionsCatalog } from '@/hooks/use-permissions-catalog';
import { useSignerDetail } from '@/features/plugin-signers';
import type { PluginSigner } from '@/features/plugin-signers';
import { PART_COLORS } from '../../shared/constants';
import { useInstalledPlugin, usePluginAuditTail, enablePlugin, disablePlugin } from '../api';

interface InstalledPluginDetailProps {
  pluginId: string;
  tenantSlug: string;
  onUninstall: () => void;
  onClose: () => void;
  /** When true, the build-log accordion mounts open. Used to deep-link from
   *  the install-progress modal after a failed install. */
  initialBuildLogOpen?: boolean;
}

// ─── Signer chip ──────────────────────────────────────────────────────────────

/**
 * Per-status visual config for the signer chip. Verified = green, revoked =
 * red, pending = gray. Matches the signer list/detail styling.
 */
const SIGNER_STATUS_CONFIG: Record<
  PluginSigner['status'],
  { color: string; label: string; Icon: typeof IconCircleCheck }
> = {
  verified: { color: 'green', label: 'verified', Icon: IconCircleCheck },
  revoked: { color: 'red', label: 'revoked', Icon: IconCircleX },
  pending: { color: 'gray', label: 'pending', Icon: IconClock },
};

function fingerprintShort(fp: string): string {
  return fp.slice(0, 8);
}

interface SignerChipProps {
  signerId: string | undefined;
}

/** Chip in the plugin-detail header showing signer status + short fingerprint.
 *  Click opens a HoverCard/Popover-style inline detail view. */
function SignerChip({ signerId }: SignerChipProps) {
  const signer = useSignerDetail(signerId ?? '');

  if (!signerId) {
    // Unsigned = orange warning chip.
    return (
      <Tooltip label="This plugin has no signer attached. Install with caution." withArrow>
        <Badge
          color="orange"
          variant="light"
          size="sm"
          leftSection={<IconAlertTriangle size={10} />}
          data-testid="plugin-signer-chip-unsigned"
        >
          Unsigned
        </Badge>
      </Tooltip>
    );
  }

  if (!signer) {
    // Signer id set but record missing (deleted) — flag as broken trust.
    return (
      <Badge
        color="red"
        variant="light"
        size="sm"
        leftSection={<IconAlertCircle size={10} />}
        data-testid="plugin-signer-chip-missing"
      >
        Signer missing
      </Badge>
    );
  }

  const status = SIGNER_STATUS_CONFIG[signer.status];

  return (
    <HoverCard width={320} shadow="md" withArrow position="bottom-start">
      <HoverCard.Target>
        <Badge
          color={status.color}
          variant="light"
          size="sm"
          leftSection={<status.Icon size={10} />}
          style={{ cursor: 'pointer' }}
          data-testid="plugin-signer-chip"
          data-status={signer.status}
        >
          {signer.name} · {fingerprintShort(signer.fingerprint)}
        </Badge>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap="xs">
          <Group gap="xs">
            <IconShieldLock size={14} />
            <Text size="sm" fw={600}>
              {signer.name}
            </Text>
            <Badge color={status.color} variant="light" size="xs">
              {status.label}
            </Badge>
          </Group>
          <Group gap={4} wrap="nowrap">
            <Text size="xs" c="var(--mantine-color-gray-7)" fw={500}>
              Fingerprint:
            </Text>
            <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
              {signer.fingerprint}
            </Text>
            <CopyButton value={signer.fingerprint} timeout={2000}>
              {({ copied, copy }) => (
                <ActionIcon
                  size="xs"
                  variant="subtle"
                  color={copied ? 'teal' : 'gray'}
                  onClick={copy}
                  aria-label="Copy signer fingerprint"
                >
                  {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                </ActionIcon>
              )}
            </CopyButton>
          </Group>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Scope: {signer.tenant_scope ?? 'Global'}
          </Text>
          {signer.description && <Text size="xs">{signer.description}</Text>}
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

export function InstalledPluginDetail({
  pluginId,
  tenantSlug,
  onUninstall,
  onClose: _onClose,
  initialBuildLogOpen = false,
}: InstalledPluginDetailProps) {
  const plugin = useInstalledPlugin(pluginId, tenantSlug);
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
        await disablePlugin(plugin.id, tenantSlug);
        notify.info('Plugin disabled', `${plugin.display_name} is now inactive.`);
      } else {
        await enablePlugin(plugin.id, tenantSlug);
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
            <Group gap="xs" wrap="wrap">
              <Title order={4}>{plugin.display_name}</Title>
              {plugin.has_errors && (
                <StatusBadge kind="error" size="sm">
                  has errors
                </StatusBadge>
              )}
              <StatusBadge kind={plugin.enabled ? 'active' : 'neutral'} size="sm">
                {plugin.enabled ? 'enabled' : 'disabled'}
              </StatusBadge>
              <SignerChip signerId={plugin.signer_id} />
            </Group>
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {plugin.slug} · v{plugin.version}
            </Text>
            <Group gap={4} mt={4}>
              {plugin.parts.map((part) => (
                <Badge key={part} size="xs" color={PART_COLORS[part]} variant="light">
                  {part}
                </Badge>
              ))}
            </Group>
          </Stack>
        </Group>
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
        <Button size="sm" variant="subtle" color="red.8" onClick={onUninstall}>
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
                  <Code c={known ? 'var(--mantine-color-green-7)' : 'var(--mantine-color-red-7)'}>
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

      {/* Build log (only rendered when captured) */}
      {plugin.last_build_log && (
        <>
          <Divider />
          <Accordion
            variant="separated"
            defaultValue={initialBuildLogOpen ? 'build-log' : null}
            data-testid="plugin-build-log-accordion"
          >
            <Accordion.Item value="build-log">
              <Accordion.Control icon={<IconFileText size={16} />}>
                <Group gap="xs">
                  <Text size="sm" fw={600}>
                    Build log
                  </Text>
                  {plugin.build_state === 'failed' && (
                    <Badge size="xs" color="red" variant="light">
                      build failed
                    </Badge>
                  )}
                </Group>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  <Group justify="flex-end">
                    <CopyButton value={plugin.last_build_log} timeout={2000}>
                      {({ copied, copy }) => (
                        <Button
                          size="xs"
                          variant="subtle"
                          leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                          onClick={copy}
                        >
                          {copied ? 'Copied' : 'Copy log'}
                        </Button>
                      )}
                    </CopyButton>
                  </Group>
                  <Code
                    block
                    style={{
                      maxHeight: 320,
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      fontSize: 12,
                      lineHeight: 1.5,
                    }}
                  >
                    {plugin.last_build_log}
                  </Code>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        </>
      )}

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
