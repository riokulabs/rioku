/**
 * <AccessPolicyDetail> — read-only view of a single access policy.
 * Shows full CEL condition (read-only ConditionEditor) + metadata.
 */
import { Stack, Group, Text, Badge, Title, Divider, Button } from '@mantine/core';
import dayjs from 'dayjs';
import { ConditionEditor } from '@/components/condition-editor';
import type { AccessPolicy } from '../types';

interface AccessPolicyDetailProps {
  policy: AccessPolicy;
  onEdit: () => void;
  onDelete: () => void;
}

export function AccessPolicyDetail({ policy, onEdit, onDelete }: AccessPolicyDetailProps) {
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
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={onEdit}>
            Edit
          </Button>
          <Button size="xs" variant="light" color="red.8" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Group>

      <Divider />

      <Stack gap="xs">
        <Text size="sm" fw={600}>
          CEL Condition
        </Text>
        <ConditionEditor
          value={policy.condition}
          onChange={() => undefined}
          readOnly
          height={120}
        />
      </Stack>

      <Stack gap="xs">
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Created {dayjs(policy.created_at).format('MMM D, YYYY HH:mm')}
        </Text>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          ID: <code>{policy.id}</code>
        </Text>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Tenant: <code>{policy.tenant_id}</code>
        </Text>
      </Stack>
    </Stack>
  );
}
