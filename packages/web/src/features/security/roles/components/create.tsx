/**
 * <RoleCreate> — role creation form.
 */
import { useState } from 'react';
import { Stack, TextInput, Textarea, Select, Button, Group } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useDirtyForm } from '@/hooks/use-dirty-form';
import { useRoleList } from '../api';
import { roleCreateSchema, type RoleCreateFormValues } from '../schemas';

interface RoleCreateProps {
  tenantId: string;
  onSave: (values: RoleCreateFormValues) => Promise<void>;
  onCancel: () => void;
}

export function RoleCreate({ tenantId: _tenantId, onSave, onCancel }: RoleCreateProps) {
  const [saving, setSaving] = useState(false);
  const roles = useRoleList();

  const parentOptions = roles.map((r) => ({ value: r.id, label: r.name }));

  const form = useForm<RoleCreateFormValues>({
    validate: schemaResolver(roleCreateSchema, { sync: true }),
    initialValues: {
      name: '',
      description: '',
      parent_id: undefined,
    },
  });

  useDirtyForm(form);

  async function handleSubmit(values: RoleCreateFormValues) {
    setSaving(true);
    try {
      await onSave(values);
      form.resetDirty();
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
      <Stack gap="md">
        <TextInput
          label="Name"
          placeholder="e.g. ops-viewer"
          description="Lowercase alphanumeric, hyphens, dots, or colons."
          required
          {...form.getInputProps('name')}
        />

        <Textarea
          label="Description"
          placeholder="Describe this role…"
          rows={3}
          {...form.getInputProps('description')}
        />

        <Select
          label="Parent role (optional)"
          data={parentOptions}
          searchable
          clearable
          placeholder="No parent"
          {...form.getInputProps('parent_id')}
        />

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create role
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
