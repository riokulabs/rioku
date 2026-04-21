/**
 * <TlsCipherConfig> — MultiSelect form for configuring allowed TLS cipher suites.
 *
 * Task 8b.8
 */
import { useState, useEffect } from 'react';
import {
  Button,
  Group,
  MultiSelect,
  Stack,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useCurrentTlsConfig, updateTlsCiphers } from '../api';
import { tlsCiphersSchema } from '../schemas';
import { ALL_TLS_CIPHERS } from '../tls-constants';
import type { TlsCiphersValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TlsCipherConfigProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TlsCipherConfig({ tenantId, canWrite }: TlsCipherConfigProps) {
  const config = useCurrentTlsConfig();
  const [saving, setSaving] = useState(false);

  const form = useForm<TlsCiphersValues>({
    mode: 'controlled',
    initialValues: {
      allowed_ciphers: config?.allowed_ciphers ?? [],
    },
    validate: schemaResolver(tlsCiphersSchema, { sync: true }),
  });

  // Sync when config loads/changes
  useEffect(() => {
    if (!config) return;
    form.setValues({ allowed_ciphers: config.allowed_ciphers });
    form.resetDirty(form.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.allowed_ciphers]);

  async function handleSubmit(values: TlsCiphersValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await updateTlsCiphers(tenantId, values.allowed_ciphers);
      notify.success('Cipher suites saved', 'Allowed cipher list has been updated.');
      form.resetDirty(form.values);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Stack gap="sm" data-testid="tls-cipher-config">
      <Title order={5}>Cipher Suites</Title>
      <form onSubmit={form.onSubmit((values) => { void handleSubmit(values); })}>
        <Stack gap="sm">
          <MultiSelect
            label="Allowed cipher suites"
            description="TLS 1.2 and 1.3 cipher suites that Caddy will accept. At least one is required."
            data={[...ALL_TLS_CIPHERS]}
            searchable
            clearable
            required
            disabled={!canWrite}
            data-testid="cipher-multiselect"
            {...form.getInputProps('allowed_ciphers')}
          />

          <Group justify="flex-end" mt="sm">
            <Tooltip label="Requires tls:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="cipher-save-button"
                >
                  Save cipher suites
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
