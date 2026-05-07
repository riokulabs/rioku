/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API TenantSection — stage-2 wiring.
 *
 * Reads via `useGetSettingsTenant`, patches via `usePatchSettingsTenant`.
 * Plan 07 — Task 2.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import {
  useGetSettingsTenant,
  usePatchSettingsTenant,
} from '@/api/generated/settings/settings';
import { ValidationError } from '@/api/errors';
import { notify } from '@/hooks/use-notify';
import { unwrap } from './_unwrap';

interface TenantRealSectionProps {
  tenant: string;
}

export function TenantRealSection({ tenant }: TenantRealSectionProps) {
  const query = useGetSettingsTenant(tenant);
  const patch = usePatchSettingsTenant();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [defaultTheme, setDefaultTheme] = useState<'light' | 'dark' | 'auto'>('auto');
  const [parentDomain, setParentDomain] = useState('');
  const [touched, setTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const t = unwrap<{
    slug?: string;
    name?: string;
    description?: string;
    logoUrl?: string;
    parentDomain?: string;
    defaultTheme?: string;
  }>(query.data);
  useEffect(() => {
    if (!t || touched) return;
    setName(t.name ?? '');
    setDescription(t.description ?? '');
    setLogoUrl(t.logoUrl ?? '');
    setDefaultTheme((t.defaultTheme as 'light' | 'dark' | 'auto' | undefined) ?? 'auto');
    setParentDomain(t.parentDomain ?? '');
  }, [t, touched]);

  if (query.isLoading)
    return (
      <Stack align="center" py="xl" data-testid="tenant-real-loading">
        <Loader />
      </Stack>
    );
  if (query.isError)
    return (
      <Alert color="red" data-testid="tenant-real-error">
        Failed to load tenant: {(query.error as Error).message}
      </Alert>
    );

  async function onSave() {
    setFieldErrors({});
    try {
      await patch.mutateAsync({
        tenant,
        data: {
          name,
          description,
          logoUrl,
          defaultTheme,
          parentDomain,
        },
      });
      notify.success('Tenant settings updated');
      setTouched(false);
      await query.refetch();
    } catch (err) {
      if (err instanceof ValidationError && err.fields) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) {
          flat[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        setFieldErrors(flat);
      } else {
        notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
      }
    }
  }

  return (
    <Stack gap="lg" data-testid="tenant-real-section">
      <Title order={5}>General</Title>
      <TextInput
        label="Tenant slug"
        value={t?.slug ?? ''}
        readOnly
        disabled
        data-testid="tenant-real-slug"
      />
      <TextInput
        label="Display name"
        value={name}
        onChange={(e) => {
          setName(e.currentTarget.value);
          setTouched(true);
        }}
        error={fieldErrors.name}
        data-testid="tenant-real-name"
      />
      <Textarea
        label="Description"
        value={description}
        onChange={(e) => {
          setDescription(e.currentTarget.value);
          setTouched(true);
        }}
        error={fieldErrors.description}
        data-testid="tenant-real-description"
      />
      <TextInput
        label="Logo URL"
        value={logoUrl}
        onChange={(e) => {
          setLogoUrl(e.currentTarget.value);
          setTouched(true);
        }}
        data-testid="tenant-real-logo"
      />
      <TextInput
        label="Parent domain"
        value={parentDomain}
        onChange={(e) => {
          setParentDomain(e.currentTarget.value);
          setTouched(true);
        }}
        data-testid="tenant-real-parent-domain"
      />
      <Select
        label="Default theme"
        value={defaultTheme}
        onChange={(v) => {
          setDefaultTheme((v) ?? 'auto');
          setTouched(true);
        }}
        data={[
          { value: 'auto', label: 'Auto' },
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
        ]}
        data-testid="tenant-real-theme"
      />
      <Group justify="flex-end">
        <Button
          onClick={() => {
            void onSave();
          }}
          loading={patch.isPending}
          disabled={!touched}
          data-testid="tenant-real-save"
        >
          Save
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Audit emitted server-side on PATCH.
      </Text>
    </Stack>
  );
}
