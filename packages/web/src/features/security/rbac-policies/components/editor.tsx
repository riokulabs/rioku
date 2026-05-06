/**
 * <RbacPolicyEditor> — create / edit form for a RBAC policy.
 */
import { useState } from 'react';
import { Stack, TextInput, Textarea, Select, Switch, Button, Group } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useDirtyForm } from '@/hooks/use-dirty-form';
import { useListRoles } from '@/features/security/roles/realApi';
import { rbacPolicySchema, type RbacPolicyFormValues } from '../schemas';
import type { RbacPolicyFull } from '../types';

interface RbacPolicyEditorProps {
  initial?: RbacPolicyFull;
  tenant: string;
  onSave: (values: RbacPolicyFormValues) => Promise<void>;
  onCancel: () => void;
}

export function RbacPolicyEditor({ initial, tenant, onSave, onCancel }: RbacPolicyEditorProps) {
  const [saving, setSaving] = useState(false);

  const rolesResult = useListRoles(tenant, { query: { enabled: tenant.length > 0 } });
  const roleOptions = (rolesResult.data?.data.roles ?? []).map(
    (r: { id?: string; name?: string }) => ({
      value: r.id ?? '',
      label: r.name ?? r.id ?? '',
    }),
  );

  const form = useForm<RbacPolicyFormValues>({
    validate: schemaResolver(rbacPolicySchema, { sync: true }),
    initialValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      enabled: initial?.enabled ?? true,
      subject_type: initial?.subject_type ?? 'user',
      subject_id: initial?.subject_id ?? '',
      role_id: initial?.role_id ?? '',
    },
  });

  useDirtyForm(form);

  async function handleSubmit(values: RbacPolicyFormValues) {
    setSaving(true);
    try {
      await onSave(values);
      form.resetDirty(form.values);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
      <Stack gap="md">
        <TextInput
          label="Name"
          placeholder="e.g. devs-bind-engineering"
          required
          {...form.getInputProps('name')}
        />

        <Textarea
          label="Description"
          placeholder="Describe this policy…"
          rows={3}
          {...form.getInputProps('description')}
        />

        <Select
          label="Subject type"
          data={[
            { value: 'user', label: 'User' },
            { value: 'group', label: 'Group' },
            { value: 'service-account', label: 'Service account' },
            { value: 'role-template', label: 'Role template' },
          ]}
          required
          {...form.getInputProps('subject_type')}
        />

        <TextInput
          label="Subject ID"
          placeholder="user / group / sa identifier"
          required
          {...form.getInputProps('subject_id')}
        />

        <Select
          label="Bound role"
          description="Role granted to the subject by this binding."
          data={roleOptions}
          searchable
          required
          {...form.getInputProps('role_id')}
        />

        <Switch
          label="Enabled"
          description="Disabled policies are persisted but not enforced."
          checked={form.values.enabled}
          onChange={(e) => {
            form.setFieldValue('enabled', e.currentTarget.checked);
          }}
        />

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {initial ? 'Save changes' : 'Create policy'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
