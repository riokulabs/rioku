/**
 * <InstallApprovalModal> — review a candidate plugin's declared identity +
 * permissions before installing.
 *
 * Sections:
 *   - Identity (slug, name, version, signer, parts, source reference)
 *   - Declared permissions (warning icon on admin-level grants)
 *   - Zones (extracted from manifest if present)
 *   - API scopes (extracted from manifest if present)
 *
 * If any declared permission is admin-level, the Approve button is disabled
 * until the user ticks a second-confirm checkbox.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Code,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  Title,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconDownload,
  IconShieldLock,
  IconX,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import {
  installPlugin,
  isAdminLevelPermission,
  adminLevelPermissions,
} from '../api';
import type { ApprovalCandidate, Plugin } from '../types';

const PART_COLORS: Record<string, string> = {
  daemon: 'blue',
  caddy: 'teal',
  admin: 'violet',
};

interface InstallApprovalModalProps {
  candidate: ApprovalCandidate | null;
  opened: boolean;
  onApprove: (plugin: Plugin) => void;
  onCancel: () => void;
}

/** Extracts `zones` array from an unknown manifest shape. */
function extractZones(manifest: unknown): string[] {
  if (
    manifest
    && typeof manifest === 'object'
    && Array.isArray((manifest as { zones?: unknown }).zones)
  ) {
    return (manifest as { zones: unknown[] }).zones.filter(
      (z): z is string => typeof z === 'string',
    );
  }
  return [];
}

/** Extracts `api_scopes` array from an unknown manifest shape. */
function extractApiScopes(manifest: unknown): string[] {
  if (
    manifest
    && typeof manifest === 'object'
    && Array.isArray((manifest as { api_scopes?: unknown }).api_scopes)
  ) {
    return (manifest as { api_scopes: unknown[] }).api_scopes.filter(
      (s): s is string => typeof s === 'string',
    );
  }
  return [];
}

export function InstallApprovalModal({
  candidate,
  opened,
  onApprove,
  onCancel,
}: InstallApprovalModalProps) {
  const [secondConfirm, setSecondConfirm] = useState(false);
  const [installing, setInstalling] = useState(false);

  const adminPerms = candidate
    ? adminLevelPermissions(candidate.declared_permissions)
    : [];
  const requiresSecondConfirm = adminPerms.length > 0;
  const canApprove = requiresSecondConfirm ? secondConfirm : true;

  const zones = candidate ? extractZones(candidate.manifest) : [];
  const apiScopes = candidate ? extractApiScopes(candidate.manifest) : [];

  async function handleApprove() {
    if (!candidate) return;
    if (requiresSecondConfirm && !secondConfirm) return;
    setInstalling(true);
    try {
      const plugin = await installPlugin(candidate);
      notify.success(
        'Plugin installed',
        `${plugin.display_name} v${plugin.version} is now active.`,
      );
      setSecondConfirm(false);
      onApprove(plugin);
    } catch {
      notify.error('Install failed', 'Please try again.');
    } finally {
      setInstalling(false);
    }
  }

  function handleCancel() {
    setSecondConfirm(false);
    notify.info('Install cancelled', 'No changes were made.');
    onCancel();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleCancel}
      title={
        <Group gap="xs">
          <IconShieldLock size={18} />
          <Text fw={600}>Review plugin install</Text>
        </Group>
      }
      size="lg"
    >
      {candidate && (
        <Stack gap="md">
          {/* ── Identity ── */}
          <Stack gap={4}>
            <Title order={5}>{candidate.display_name}</Title>
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {candidate.slug} · v{candidate.version}
            </Text>
            <Group gap="xs" mt={4}>
              <Text size="xs" fw={500} c="var(--mantine-color-gray-8)">
                Signer:
              </Text>
              <Text size="xs" ff="monospace">
                {candidate.signer ?? 'unverified'}
              </Text>
            </Group>
            {candidate.reference && (
              <Group gap="xs" mt={2}>
                <Text size="xs" fw={500} c="var(--mantine-color-gray-8)">
                  Source:
                </Text>
                <Text size="xs" ff="monospace" style={{ wordBreak: 'break-all' }}>
                  {candidate.reference}
                </Text>
              </Group>
            )}
            <Group gap={4} mt={6}>
              {candidate.parts.map((part) => (
                <Badge
                  key={part}
                  size="xs"
                  color={PART_COLORS[part] ?? 'gray'}
                  variant="light"
                >
                  {part}
                </Badge>
              ))}
            </Group>
          </Stack>

          <Divider />

          {/* ── Declared permissions ── */}
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Declared permissions
            </Text>
            {candidate.declared_permissions.length === 0 ? (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                No permissions declared.
              </Text>
            ) : (
              <Stack gap={4}>
                {candidate.declared_permissions.map((perm) => {
                  const admin = isAdminLevelPermission(perm);
                  return (
                    <Group key={perm} gap="xs" wrap="nowrap">
                      {admin ? (
                        <IconAlertTriangle
                          size={14}
                          color="var(--mantine-color-red-6)"
                          aria-label="admin-level permission"
                        />
                      ) : (
                        <IconCircleCheck
                          size={14}
                          color="var(--mantine-color-green-6)"
                        />
                      )}
                      {admin ? (
                        <Code c="var(--mantine-color-red-7)">{perm}</Code>
                      ) : (
                        <Code>{perm}</Code>
                      )}
                      {admin && (
                        <Badge size="xs" color="red" variant="light">
                          admin-level
                        </Badge>
                      )}
                    </Group>
                  );
                })}
              </Stack>
            )}
          </Stack>

          <Divider />

          {/* ── Zones ── */}
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              Zones
            </Text>
            {zones.length === 0 ? (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                None declared.
              </Text>
            ) : (
              <Group gap={4}>
                {zones.map((z) => (
                  <Badge key={z} size="xs" color="indigo" variant="light">
                    {z}
                  </Badge>
                ))}
              </Group>
            )}
          </Stack>

          {/* ── API scopes ── */}
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              API scopes
            </Text>
            {apiScopes.length === 0 ? (
              <Text size="xs" c="var(--mantine-color-gray-7)">
                None declared.
              </Text>
            ) : (
              <Stack gap={2}>
                {apiScopes.map((scope) => (
                  <Code key={scope}>{scope}</Code>
                ))}
              </Stack>
            )}
          </Stack>

          {/* ── Second-confirm ── */}
          {requiresSecondConfirm && (
            <Alert
              icon={<IconAlertTriangle size={16} />}
              color="red"
              variant="light"
              title="Admin-level permissions requested"
            >
              <Stack gap="xs">
                <Text size="xs">
                  This plugin requests {adminPerms.length} permission
                  {adminPerms.length === 1 ? '' : 's'} that grant admin-tier
                  access:
                </Text>
                <Stack gap={2}>
                  {adminPerms.map((p) => (
                    <Code key={p} c="var(--mantine-color-red-7)">
                      {p}
                    </Code>
                  ))}
                </Stack>
                <Checkbox
                  mt="xs"
                  label="I understand this plugin requests admin-level permissions"
                  checked={secondConfirm}
                  onChange={(e) => {
                    setSecondConfirm(e.currentTarget.checked);
                  }}
                />
              </Stack>
            </Alert>
          )}

          {/* ── Actions ── */}
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              leftSection={<IconX size={14} />}
              onClick={handleCancel}
            >
              Decline
            </Button>
            <Button
              color="green"
              leftSection={<IconDownload size={14} />}
              disabled={!canApprove}
              loading={installing}
              onClick={() => void handleApprove()}
            >
              Approve &amp; install
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
