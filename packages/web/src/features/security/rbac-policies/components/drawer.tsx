/**
 * <RbacPolicyDrawer> — quick-info side-drawer for an RBAC policy.
 *
 * Renders the bare-essential identity (name, subject, role, enabled) plus
 * an "Open full page" button that navigates to the dedicated full-page
 * view. Used as the click target from `RbacPolicyList`.
 */
import { Stack, Group, Text, Badge, Title, Divider, Button } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconExternalLink } from '@tabler/icons-react';
import type { RbacPolicyFull, RbacSubjectType } from '../types';

interface RbacPolicyDrawerProps {
  policy: RbacPolicyFull;
  tenant: string;
  onClose: () => void;
}

const SUBJECT_LABELS: Record<RbacSubjectType, string> = {
  user: 'User',
  group: 'Group',
  'service-account': 'Service account',
};

export function RbacPolicyDrawer({ policy, tenant, onClose }: RbacPolicyDrawerProps) {
  return (
    <Stack gap="md">
      <Stack gap={4}>
        <Title order={5}>{policy.name}</Title>
        <Group gap="xs">
          <Badge variant="light" color="violet" size="sm">
            {SUBJECT_LABELS[policy.subject_type]}
          </Badge>
          {policy.enabled ? (
            <Badge variant="light" color="green" size="sm">
              Enabled
            </Badge>
          ) : (
            <Badge variant="light" color="gray" size="sm">
              Disabled
            </Badge>
          )}
        </Group>
      </Stack>

      <Divider />

      {policy.description && <Text size="sm">{policy.description}</Text>}

      <Stack gap={2}>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Subject
        </Text>
        <Text size="sm" style={{ fontFamily: 'monospace' }}>
          {policy.subject_id || '—'}
        </Text>
      </Stack>

      <Stack gap={2}>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Bound role
        </Text>
        <Text size="sm" style={{ fontFamily: 'monospace' }}>
          {policy.role_id || '—'}
        </Text>
      </Stack>

      <Group justify="flex-end" gap="xs" mt="md">
        <Button variant="default" size="xs" onClick={onClose}>
          Close
        </Button>
        <Button
          size="xs"
          rightSection={<IconExternalLink size={14} />}
          component={Link}
          to="/t/$tenant/security/rbac-policies/$policyId"
          // Route tree may not yet know this dynamic path; cast aligns with
          // the same pattern used by `roles/components/drawer.tsx`.
          params={{ tenant, policyId: policy.id } as never}
        >
          Open full page
        </Button>
      </Group>
    </Stack>
  );
}
