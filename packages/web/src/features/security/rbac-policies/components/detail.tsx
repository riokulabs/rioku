/**
 * <RbacPolicyDetail> — read-only view of a single RBAC policy.
 */
import { Stack, Group, Text, Badge, Title, Divider, Button } from '@mantine/core';
import dayjs from 'dayjs';
import type { RbacPolicyFull, RbacSubjectType } from '../types';

interface RbacPolicyDetailProps {
  policy: RbacPolicyFull;
  onEdit: () => void;
  onDelete: () => void;
  /** When true, hides the Edit/Delete buttons (used by viewer-permission UIs). */
  readOnly?: boolean;
}

const SUBJECT_LABELS: Record<RbacSubjectType, string> = {
  user: 'User',
  group: 'Group',
  'service-account': 'Service account',
};

export function RbacPolicyDetail({ policy, onEdit, onDelete, readOnly }: RbacPolicyDetailProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={4}>{policy.name}</Title>
          <Group gap="xs">
            <Badge variant="light" color="violet">
              {SUBJECT_LABELS[policy.subject_type]}
            </Badge>
            {policy.enabled ? (
              <Badge variant="light" color="green">
                Enabled
              </Badge>
            ) : (
              <Badge variant="light" color="gray">
                Disabled
              </Badge>
            )}
          </Group>
        </Stack>
        {!readOnly && (
          <Group gap="xs">
            <Button size="xs" variant="light" onClick={onEdit}>
              Edit
            </Button>
            <Button size="xs" variant="light" color="red.8" onClick={onDelete}>
              Delete
            </Button>
          </Group>
        )}
      </Group>

      <Divider />

      {policy.description && <Text size="sm">{policy.description}</Text>}

      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Subject
        </Text>
        <Text size="sm" style={{ fontFamily: 'monospace' }}>
          {policy.subject_id || '—'}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Bound role
        </Text>
        <Text size="sm" style={{ fontFamily: 'monospace' }}>
          {policy.role_id || '—'}
        </Text>
      </Stack>

      <Stack gap="xs">
        {policy.created_at && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Created {dayjs(policy.created_at).format('MMM D, YYYY HH:mm')}
          </Text>
        )}
        <Text size="xs" c="var(--mantine-color-gray-7)">
          ID: <code>{policy.id}</code>
        </Text>
      </Stack>
    </Stack>
  );
}
