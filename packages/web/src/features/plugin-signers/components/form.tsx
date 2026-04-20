/**
 * <SignerForm> — create/edit a plugin signer.
 *
 * Validation is driven by `createSignerSchema` / `updateSignerSchema` via
 * `schemaResolver({ sync: true })` to honour the B3 form-validation rule.
 *
 * Scope switching:
 *   - Tenant-scoped creator: scope locked to the current tenant (segmented
 *     control is hidden when `allowGlobalScope === false`).
 *   - Super-admin creator: can toggle Global / Tenant. When Global is
 *     selected, tenant_scope is set to null.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { createSigner, updateSigner } from '../api';
import {
  createSignerSchema,
  updateSignerSchema,
} from '../schemas';
import type { PluginSigner } from '../types';

type ScopeValue = 'tenant' | 'global';

interface SignerFormValues {
  name: string;
  fingerprint: string;
  description: string;
  scope: ScopeValue;
}

interface SignerFormProps {
  mode: 'create' | 'edit';
  /**
   * The tenant id to use when scope='tenant' on create. Ignored for edit.
   * Pass null when creating from super-admin (no default tenant) — the
   * scope segmented control will default to 'global'.
   */
  tenantId: string | null;
  /** Super-admin flag — if true, allow toggling between Tenant and Global scope. */
  allowGlobalScope: boolean;
  initialValues?: PluginSigner;
  onSuccess: (signer: PluginSigner) => void;
  onCancel: () => void;
}

function initialFromSigner(
  s: PluginSigner | undefined,
  defaultScope: ScopeValue,
): SignerFormValues {
  return {
    name: s?.name ?? '',
    fingerprint: s?.fingerprint ?? '',
    description: s?.description ?? '',
    scope: s ? (s.tenant_scope === null ? 'global' : 'tenant') : defaultScope,
  };
}

export function SignerForm({
  mode,
  tenantId,
  allowGlobalScope,
  initialValues,
  onSuccess,
  onCancel,
}: SignerFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultScope: ScopeValue = allowGlobalScope && tenantId === null
    ? 'global'
    : 'tenant';

  const schema = mode === 'create' ? createSignerSchema : updateSignerSchema;

  const form = useForm<SignerFormValues>({
    initialValues: initialFromSigner(initialValues, defaultScope),
    // schemaResolver on the full form values runs both create & update shapes
    // below via a thin adapter — only the relevant fields are validated.
    validate: schemaResolver(schema, { sync: true }),
  });

  async function handleSubmit(values: SignerFormValues) {
    setLoading(true);
    setError(null);
    try {
      const description = values.description.trim();

      if (mode === 'create') {
        const scope = values.scope === 'global' ? null : tenantId;
        if (values.scope === 'tenant' && tenantId === null) {
          setError(
            'Cannot create a tenant-scoped signer from the super-admin view without a tenant context.',
          );
          return;
        }
        const signer = await createSigner({
          tenant_scope: scope,
          name: values.name.trim(),
          fingerprint: values.fingerprint.trim().toLowerCase(),
          ...(description !== '' ? { description } : {}),
        });
        notify.success('Signer added', `${signer.name} is pending verification.`);
        onSuccess(signer);
      } else if (initialValues) {
        const signer = await updateSigner(initialValues.id, {
          name: values.name.trim(),
          fingerprint: values.fingerprint.trim().toLowerCase(),
          description,
        });
        notify.success('Signer updated', `${signer.name} saved.`);
        onSuccess(signer);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save signer';
      setError(msg);
    } finally {
      setLoading(false);
    }
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
          label="Name"
          placeholder="Rioku Labs"
          required
          {...form.getInputProps('name')}
        />

        <TextInput
          label="Fingerprint (SHA-256)"
          placeholder="64 lowercase hex characters"
          required
          description="Public key fingerprint — exactly 64 lowercase hex chars."
          styles={{ input: { fontFamily: 'ui-monospace, monospace' } }}
          {...form.getInputProps('fingerprint')}
        />

        <Textarea
          label="Description"
          placeholder="Optional — purpose, rotation policy, contact."
          minRows={2}
          {...form.getInputProps('description')}
        />

        {mode === 'create' && allowGlobalScope && (
          <Stack gap="xs">
            <Text size="sm" fw={500}>
              Scope
            </Text>
            <SegmentedControl<ScopeValue>
              data={[
                { value: 'tenant', label: 'Tenant' },
                { value: 'global', label: 'Global (super-admin)' },
              ]}
              value={form.values.scope}
              onChange={(value) => {
                form.setFieldValue('scope', value);
              }}
              disabled={tenantId === null}
            />
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Global signers are trusted by every tenant. Use sparingly.
            </Text>
          </Stack>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            {mode === 'create' ? 'Add signer' : 'Save changes'}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
