/**
 * <TlsAcmeConfig> — ACME provider/email/dns_challenge configuration form.
 *
 * Task 8b.8
 */
import { useState, useEffect } from 'react';
import {
  Button,
  Checkbox,
  Group,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useCurrentTlsConfig, updateTlsAcmeConfig } from '../api';
import { tlsAcmeConfigSchema } from '../schemas';
import type { TlsAcmeConfigValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TlsAcmeConfigProps {
  tenantId: string;
  canWrite: boolean;
}

// ─── Provider options ─────────────────────────────────────────────────────────

const PROVIDER_OPTIONS = [
  { value: 'lets-encrypt', label: "Let's Encrypt" },
  { value: 'zerossl', label: 'ZeroSSL' },
  { value: 'custom', label: 'Custom ACME' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function TlsAcmeConfig({ tenantId, canWrite }: TlsAcmeConfigProps) {
  const config = useCurrentTlsConfig();
  const [saving, setSaving] = useState(false);

  const form = useForm<TlsAcmeConfigValues>({
    mode: 'controlled',
    initialValues: {
      provider: config?.acme.provider ?? 'lets-encrypt',
      email: config?.acme.email ?? '',
      ...(config?.acme.directory_url != null ? { directory_url: config.acme.directory_url } : {}),
      dns_challenge: config?.acme.dns_challenge ?? false,
    },
    validate: schemaResolver(tlsAcmeConfigSchema, { sync: true }),
  });

  // Sync form when config loads/changes from store
  useEffect(() => {
    if (!config) return;
    form.setValues({
      provider: config.acme.provider,
      email: config.acme.email,
      ...(config.acme.directory_url != null ? { directory_url: config.acme.directory_url } : {}),
      dns_challenge: config.acme.dns_challenge,
    });
    form.resetDirty(form.values);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    config?.acme.provider,
    config?.acme.email,
    config?.acme.directory_url,
    config?.acme.dns_challenge,
  ]);

  async function handleSubmit(values: TlsAcmeConfigValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await updateTlsAcmeConfig(tenantId, values);
      notify.success('ACME config saved', 'ACME configuration has been updated.');
      form.resetDirty(form.values);
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const isCustom = form.values.provider === 'custom';

  return (
    <Stack gap="sm" data-testid="tls-acme-config">
      <Title order={5}>ACME Configuration</Title>
      <form
        onSubmit={form.onSubmit((values) => {
          void handleSubmit(values);
        })}
      >
        <Stack gap="sm">
          <Select
            label="ACME Provider"
            description="Certificate Authority used for automated TLS"
            data={PROVIDER_OPTIONS}
            required
            data-testid="acme-provider-select"
            {...form.getInputProps('provider')}
          />

          <TextInput
            label="Account email"
            description="Email used to register the ACME account"
            placeholder="admin@example.com"
            required
            data-testid="acme-email-input"
            {...form.getInputProps('email')}
          />

          {isCustom && (
            <TextInput
              label="Directory URL"
              description="ACME directory URL for your custom CA"
              placeholder="https://acme.example.com/directory"
              required
              data-testid="acme-directory-url-input"
              {...form.getInputProps('directory_url')}
            />
          )}

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Challenge type
            </Text>
            <Checkbox
              label="Use DNS-01 challenge"
              description="When enabled, uses DNS-01 (DNS record) instead of HTTP-01 challenge"
              data-testid="acme-dns-challenge-checkbox"
              {...form.getInputProps('dns_challenge', { type: 'checkbox' })}
            />
          </Stack>

          <Group justify="flex-end" mt="sm">
            <Tooltip label="Requires tls:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="acme-save-button"
                >
                  Save ACME config
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
