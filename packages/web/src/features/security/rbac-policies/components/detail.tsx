/**
 * <RbacPolicyDetail> — read-only view of a single RBAC policy.
 */
import { Stack, Group, Text, Badge, Title, Divider, Button } from '@mantine/core';
import dayjs from 'dayjs';
import { ConditionEditor } from '@/components/condition-editor';
import type { RbacPolicyFull, RbacPolicyType } from '../types';

interface RbacPolicyDetailProps {
  policy: RbacPolicyFull;
  onEdit: () => void;
  onDelete: () => void;
}

const TYPE_LABELS: Record<RbacPolicyType, string> = {
  'totp-required': 'TOTP Required',
  'step-up-required': 'Step-up Required',
  'login-window': 'Login Window',
  custom: 'Custom CEL',
};

export function RbacPolicyDetail({ policy, onEdit, onDelete }: RbacPolicyDetailProps) {
  return (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Title order={4}>{policy.name}</Title>
          <Group gap="xs">
            <Badge variant="light" color="violet">
              {TYPE_LABELS[policy.policy_type]}
            </Badge>
          </Group>
        </Stack>
        <Group gap="xs">
          <Button size="xs" variant="light" onClick={onEdit}>
            Edit
          </Button>
          <Button size="xs" variant="light" color="red" onClick={onDelete}>
            Delete
          </Button>
        </Group>
      </Group>

      <Divider />

      {policy.description && (
        <Text size="sm">{policy.description}</Text>
      )}

      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Affected Roles
        </Text>
        {policy.affected_role_ids.length === 0 ? (
          <Text size="sm" c="dimmed">
            No roles selected
          </Text>
        ) : (
          <Group gap="xs">
            {policy.affected_role_ids.map((id) => (
              <Badge key={id} variant="outline" size="sm">
                {id}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      {policy.window && (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            {policy.policy_type === 'login-window' ? 'Login Window' : 'Step-up Timeout'}
          </Text>
          <Text size="sm" style={{ fontFamily: 'monospace' }}>
            {policy.window}
          </Text>
        </Stack>
      )}

      {policy.policy_type === 'custom' && policy.condition && (
        <Stack gap="xs">
          <Text size="sm" fw={600}>
            CEL Condition
          </Text>
          <ConditionEditor
            value={policy.condition}
            onChange={() => undefined}
            readOnly
            height={100}
          />
        </Stack>
      )}

      <Stack gap="xs">
        <Text size="xs" c="dimmed">
          Created {dayjs(policy.created_at).format('MMM D, YYYY HH:mm')}
        </Text>
        <Text size="xs" c="dimmed">
          ID: <code>{policy.id}</code>
        </Text>
      </Stack>
    </Stack>
  );
}
