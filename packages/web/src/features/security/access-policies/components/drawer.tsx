/**
 * <AccessPolicyDrawer> — quick-info side-drawer view of a policy.
 *
 * Used inside the access-policies list-page Drawer. Renders the same
 * read-only metadata as <AccessPolicyDetail> but with a prominent
 * "Open full page" button that navigates to the dedicated detail route
 * `/t/$tenant/security/access-policies/$policyId` so the user can use
 * the Test-CEL tab and see the full audit history.
 */
import { Stack, Group, Button, Title, Badge, Text, Divider } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { IconExternalLink, IconEdit, IconTrash } from '@tabler/icons-react';
import dayjs from 'dayjs';
import type { AccessPolicy } from '../types';

interface AccessPolicyDrawerProps {
  policy: AccessPolicy;
  /** URL slug for the current tenant (used to build the full-page link). */
  tenantSlug: string;
  onEdit: () => void;
  onDelete: () => void;
}

export function AccessPolicyDrawer({
  policy,
  tenantSlug,
  onEdit,
  onDelete,
}: AccessPolicyDrawerProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={4}>{policy.name}</Title>
          <Group gap="xs">
            <Badge color={policy.action === 'allow' ? 'green' : 'red'} variant="light">
              {policy.action}
            </Badge>
            <Badge color={policy.enabled ? 'teal' : 'gray'} variant="outline">
              {policy.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <Badge variant="outline" color="blue">
              Priority {policy.priority}
            </Badge>
          </Group>
        </Stack>
      </Group>

      <Divider />

      <Stack gap="xs">
        <Text size="sm" fw={600}>
          CEL expression
        </Text>
        <Text
          size="sm"
          style={{
            fontFamily: 'monospace',
            background: 'var(--mantine-color-gray-0)',
            padding: 8,
            borderRadius: 4,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {policy.condition || (
            <Text component="span" c="dimmed">
              (empty)
            </Text>
          )}
        </Text>
      </Stack>

      <Stack gap={4}>
        {policy.created_at && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Created {dayjs(policy.created_at).format('MMM D, YYYY HH:mm')}
          </Text>
        )}
        <Text size="xs" c="var(--mantine-color-gray-7)">
          ID: <code>{policy.id}</code>
        </Text>
      </Stack>

      <Divider />

      <Group justify="space-between">
        {}
        <Button
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/security/access-policies/$policyId"
          params={{ tenant: tenantSlug, policyId: policy.id }}
          leftSection={<IconExternalLink size={14} />}
          variant="filled"
        >
          Open full page
        </Button>
        <Group gap="xs">
          <Button size="xs" variant="light" leftSection={<IconEdit size={14} />} onClick={onEdit}>
            Edit
          </Button>
          <Button
            size="xs"
            variant="light"
            color="red.8"
            leftSection={<IconTrash size={14} />}
            onClick={onDelete}
          >
            Delete
          </Button>
        </Group>
      </Group>
    </Stack>
  );
}
