/**
 * <RbacPolicyEditor> — create / edit form for a RBAC policy.
 */
import { useState } from 'react';
import {
  Stack,
  TextInput,
  Textarea,
  Select,
  MultiSelect,
  Button,
  Group,
  Text,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useDirtyForm } from '@/hooks/use-dirty-form';
import { ConditionEditor } from '@/components/condition-editor';
import { useMockStore } from '@/api/mock-store';
import { rbacPolicySchema, type RbacPolicyFormValues } from '../schemas';
import type { RbacPolicyFull } from '../types';

interface RbacPolicyEditorProps {
  initial?: RbacPolicyFull;
  tenantId: string;
  onSave: (values: RbacPolicyFormValues) => Promise<void>;
  onCancel: () => void;
}

export function RbacPolicyEditor({
  initial,
  tenantId: _tenantId,
  onSave,
  onCancel,
}: RbacPolicyEditorProps) {
  const [saving, setSaving] = useState(false);
  const [conditionValid, setConditionValid] = useState(true);

  const roles = useMockStore((s) => s.roles);
  const roleOptions = Object.values(roles).map((r) => ({
    value: r.id,
    label: r.name,
  }));

  const form = useForm<RbacPolicyFormValues>({
    validate: schemaResolver(rbacPolicySchema, { sync: true }),
    initialValues: {
      name: initial?.name ?? '',
      description: initial?.description ?? '',
      policy_type: initial?.policy_type ?? 'totp-required',
      affected_role_ids: initial?.affected_role_ids ?? [],
      condition: initial?.condition ?? '',
      window: initial?.window ?? '',
    },
  });

  useDirtyForm(form);

  const policyType = form.values.policy_type;
  const needsCondition = policyType === 'custom';
  const needsWindow = policyType === 'login-window' || policyType === 'step-up-required';

  async function handleSubmit(values: RbacPolicyFormValues) {
    if (needsCondition && !conditionValid) return;
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
          placeholder="e.g. totp-required-admin"
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
          label="Policy type"
          data={[
            { value: 'totp-required', label: 'TOTP Required' },
            { value: 'step-up-required', label: 'Step-up TOTP Required' },
            { value: 'login-window', label: 'Login Window' },
            { value: 'custom', label: 'Custom (CEL)' },
          ]}
          required
          {...form.getInputProps('policy_type')}
        />

        <MultiSelect
          label="Affected roles"
          description="Roles this policy applies to."
          data={roleOptions}
          searchable
          clearable
          required
          {...form.getInputProps('affected_role_ids')}
        />

        {needsWindow && (
          <TextInput
            label={policyType === 'login-window' ? 'Login window' : 'Step-up timeout (seconds)'}
            placeholder={policyType === 'login-window' ? '07:00–19:00 UTC' : '60'}
            {...form.getInputProps('window')}
          />
        )}

        {needsCondition && (
          <Stack gap="xs">
            <ConditionEditor
              label="CEL Condition"
              value={form.values.condition ?? ''}
              onChange={(v) => {
                form.setFieldValue('condition', v);
              }}
              onValidityChange={setConditionValid}
              placeholder="request.method == 'GET'"
              height={120}
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
        )}

        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={needsCondition && !conditionValid}>
            {initial ? 'Save changes' : 'Create policy'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
