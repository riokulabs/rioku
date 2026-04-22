/**
 * <AccessPolicyEditor> — create / edit form for an access policy.
 *
 * Uses Mantine form + useDirtyForm for unsaved-changes prevention.
 * ConditionEditor provides CEL editing + syntax validation.
 */
import { useState } from 'react';
import { Stack, TextInput, Select, NumberInput, Switch, Button, Group, Text } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useDirtyForm } from '@/hooks/use-dirty-form';
import { ConditionEditor } from '@/components/condition-editor';
import { accessPolicySchema, type AccessPolicyFormValues } from '../schemas';
import type { AccessPolicy } from '../types';

interface AccessPolicyEditorProps {
  /** Existing policy for editing. Omit for create mode. */
  initial?: AccessPolicy;
  tenantId: string;
  onSave: (values: AccessPolicyFormValues) => Promise<void>;
  onCancel: () => void;
}

export function AccessPolicyEditor({
  initial,
  tenantId: _tenantId,
  onSave,
  onCancel,
}: AccessPolicyEditorProps) {
  const [saving, setSaving] = useState(false);
  const [conditionValid, setConditionValid] = useState(true);

  const form = useForm<AccessPolicyFormValues>({
    validate: schemaResolver(accessPolicySchema, { sync: true }),
    initialValues: {
      name: initial?.name ?? '',
      condition: initial?.condition ?? '',
      action: initial?.action ?? 'allow',
      priority: initial?.priority ?? 100,
      enabled: initial?.enabled ?? true,
    },
  });

  // Unsaved changes navigation guard
  useDirtyForm(form);

  async function handleSubmit(values: AccessPolicyFormValues) {
    if (!conditionValid) return;
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
          placeholder="e.g. block-admin-external"
          required
          {...form.getInputProps('name')}
        />

        <Select
          label="Action"
          data={[
            { value: 'allow', label: 'Allow' },
            { value: 'deny', label: 'Deny' },
          ]}
          required
          {...form.getInputProps('action')}
        />

        <NumberInput
          label="Priority"
          description="Lower numbers run first. Range: 0–9999."
          min={0}
          max={9999}
          required
          {...form.getInputProps('priority')}
        />

        <Switch label="Enabled" {...form.getInputProps('enabled', { type: 'checkbox' })} />

        <Stack gap="xs">
          <ConditionEditor
            label="CEL Condition"
            value={form.values.condition}
            onChange={(v) => {
              form.setFieldValue('condition', v);
            }}
            onValidityChange={setConditionValid}
            placeholder={`request.method == "GET"`}
            height={140}
          />
          {form.errors.condition && (
            <Text size="xs" c="red">
              {form.errors.condition}
            </Text>
          )}
          {!conditionValid && (
            <Text size="xs" c="orange">
              CEL syntax error — fix before saving.
            </Text>
          )}
        </Stack>

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!conditionValid}>
            {initial ? 'Save changes' : 'Create policy'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
