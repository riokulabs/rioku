/**
 * <UserInviteForm> — invite a new user to a tenant.
 *
 * Stage-2 plan-02: backed by the real `POST /users` endpoint via
 * `useUserMutations`. Roles for the MultiSelect are sourced from the
 * generated roles list hook; no mock-store reads remain.
 */
import { useState } from 'react';
import {
  Stack,
  TextInput,
  Checkbox,
  Button,
  MultiSelect,
  Alert,
  Text,
  Group,
  Paper,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconMail } from '@tabler/icons-react';
import { IdBadge } from '@/components/id-badge';
import { notify } from '@/hooks/use-notify';
import { useUserMutations, useTenantRoles } from '../api';
import { inviteUserSchema } from '../schemas';
import type { InviteUserFormValues } from '../schemas';

interface UserInviteFormProps {
  tenantId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function UserInviteForm({ tenantId, onSuccess, onCancel }: UserInviteFormProps) {
  const [loading, setLoading] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const roles = useTenantRoles(tenantId);
  const roleOptions = roles.map((r) => ({ value: r.id, label: r.name }));

  const { inviteUser } = useUserMutations(tenantId);

  const form = useForm<InviteUserFormValues>({
    validate: schemaResolver(inviteUserSchema, { sync: true }),
    initialValues: {
      email: '',
      name: '',
      tenant_id: tenantId,
      role_ids: [],
      force_totp_on_first_login: false,
    },
  });

  async function handleSubmit(values: InviteUserFormValues) {
    setLoading(true);
    setError(null);
    try {
      const result = await inviteUser(
        values.email,
        values.name ?? undefined,
        values.tenant_id,
        values.role_ids,
        values.force_totp_on_first_login,
      );
      setInviteToken(result.inviteToken);
      notify.success('Invitation sent', `An invite has been created for ${values.email}.`);
    } catch {
      setError('Failed to send invitation. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  if (inviteToken) {
    return (
      <Stack gap="md">
        <Alert
          icon={<IconMail size={16} />}
          color="green"
          variant="light"
          title="Invitation created"
        >
          The user has been invited.
        </Alert>
        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Invite link (placeholder — daemon SMTP integration is stage-2 deferred):
          </Text>
          <Paper withBorder p="sm" radius="sm">
            <Group gap="sm" align="center">
              <Text size="sm" ff="monospace" c="var(--mantine-color-gray-7)">
                /invite/
              </Text>
              <IdBadge id={inviteToken} label={inviteToken} />
            </Group>
          </Paper>
        </Stack>
        <Button onClick={onSuccess}>Done</Button>
      </Stack>
    );
  }

  return (
    <form
      onSubmit={form.onSubmit((v) => {
        void handleSubmit(v);
      })}
    >
      <Stack gap="md">
        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            {error}
          </Alert>
        )}

        <TextInput
          label="Email"
          placeholder="user@example.com"
          required
          {...form.getInputProps('email')}
        />

        <TextInput
          label="Name"
          placeholder="Optional display name"
          {...form.getInputProps('name')}
        />

        <MultiSelect
          label="Initial roles"
          description="At least one role is required"
          data={roleOptions}
          searchable
          required
          {...form.getInputProps('role_ids')}
        />

        <Checkbox
          label="Require TOTP on first login"
          {...form.getInputProps('force_totp_on_first_login', { type: 'checkbox' })}
        />

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Send invite
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
