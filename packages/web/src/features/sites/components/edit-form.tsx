/**
 * <SiteEditForm> — edit a site.
 *
 * Mirrors the TLS + policies + redirect_rules portion of the create wizard
 * but without wizard chrome. Prefilled from `initialValues`.
 *
 * Uses `updateSiteSchema` via Mantine form `schemaResolver({ sync: true })`.
 */
import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Divider,
  Group,
  NumberInput,
  Radio,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { updateSite } from '../api';
import { updateSiteSchema } from '../schemas';
import type { Site } from '../types';

type RedirectStatus = 301 | 302 | 307 | 308;

interface RedirectRuleRow {
  from: string;
  to: string;
  status: RedirectStatus;
}

interface SiteEditFormValues {
  name: string;
  domain: string;
  tls_mode: 'auto' | 'manual' | 'off';
  basic_auth_enabled: boolean;
  rate_limit_preset: 'none' | 'lenient' | 'standard' | 'strict';
  redirect_rules: RedirectRuleRow[];
}

interface SiteEditFormProps {
  initialValues: Site;
  onSuccess: (site: Site) => void;
  onCancel: () => void;
}

function buildInitial(site: Site): SiteEditFormValues {
  return {
    name: site.name,
    domain: site.domain,
    tls_mode: site.tls_mode,
    basic_auth_enabled: site.basic_auth_enabled,
    rate_limit_preset: site.rate_limit_preset,
    redirect_rules: site.redirect_rules.map((r) => ({
      from: r.from,
      to: r.to,
      status: r.status,
    })),
  };
}

export function SiteEditForm({ initialValues, onSuccess, onCancel }: SiteEditFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<SiteEditFormValues>({
    initialValues: buildInitial(initialValues),
    validate: schemaResolver(updateSiteSchema, { sync: true }),
  });

  function addRedirect() {
    form.setFieldValue('redirect_rules', [
      ...form.values.redirect_rules,
      { from: '/', to: '/', status: 301 },
    ]);
  }
  function removeRedirect(index: number) {
    form.setFieldValue(
      'redirect_rules',
      form.values.redirect_rules.filter((_, i) => i !== index),
    );
  }

  async function handleSubmit(values: SiteEditFormValues) {
    setLoading(true);
    setError(null);
    try {
      const patch = {
        name: values.name.trim(),
        domain: values.domain.trim(),
        tls_mode: values.tls_mode,
        basic_auth_enabled: values.basic_auth_enabled,
        rate_limit_preset: values.rate_limit_preset,
        redirect_rules: values.redirect_rules,
      };
      const updated = await updateSite(initialValues.id, patch);
      notify.success('Site saved', `${updated.domain} updated.`);
      onSuccess(updated);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save site';
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

        <Title order={5}>Identity</Title>
        <TextInput label="Site name" required {...form.getInputProps('name')} />
        <TextInput
          label="Domain"
          placeholder="www.example.com"
          required
          {...form.getInputProps('domain')}
        />

        <Divider />

        <Title order={5}>TLS</Title>
        <Radio.Group
          value={form.values.tls_mode}
          onChange={(v: string) => {
            if (v === 'auto' || v === 'manual' || v === 'off') {
              form.setFieldValue('tls_mode', v);
            }
          }}
        >
          <Stack gap="xs">
            <Radio value="auto" label="Auto (Let's Encrypt)" />
            <Radio value="manual" label="Manual certificate" />
            <Radio value="off" label="Off (plaintext only)" />
          </Stack>
        </Radio.Group>

        <Divider />

        <Title order={5}>Policies</Title>
        <Switch
          label="Basic authentication"
          description="Prompt browsers for HTTP basic auth credentials."
          checked={form.values.basic_auth_enabled}
          onChange={(e) => {
            form.setFieldValue('basic_auth_enabled', e.currentTarget.checked);
          }}
        />
        <Select
          label="Rate limit preset"
          data={[
            { value: 'none', label: 'None' },
            { value: 'lenient', label: 'Lenient (1000 req/min)' },
            { value: 'standard', label: 'Standard (100 req/min)' },
            { value: 'strict', label: 'Strict (10 req/min)' },
          ]}
          allowDeselect={false}
          {...form.getInputProps('rate_limit_preset')}
        />

        <Divider />

        <Group justify="space-between" align="center">
          <Title order={5}>Redirect rules</Title>
          <Button
            size="xs"
            variant="light"
            leftSection={<IconPlus size={14} />}
            onClick={addRedirect}
            type="button"
          >
            Add redirect
          </Button>
        </Group>

        {form.values.redirect_rules.length === 0 ? (
          <Text size="sm" c="var(--mantine-color-gray-7)">
            No redirect rules.
          </Text>
        ) : (
          <Stack gap="xs">
            {form.values.redirect_rules.map((rule, i) => (
              <Group key={`redirect-${String(i)}`} gap="xs" align="flex-end" wrap="nowrap">
                <TextInput
                  label={i === 0 ? 'From' : undefined}
                  value={rule.from}
                  onChange={(e) => {
                    const next = [...form.values.redirect_rules];
                    const row = next[i];
                    if (row) {
                      next[i] = { ...row, from: e.currentTarget.value };
                      form.setFieldValue('redirect_rules', next);
                    }
                  }}
                  placeholder="/old"
                  style={{ flex: 1 }}
                />
                <TextInput
                  label={i === 0 ? 'To' : undefined}
                  value={rule.to}
                  onChange={(e) => {
                    const next = [...form.values.redirect_rules];
                    const row = next[i];
                    if (row) {
                      next[i] = { ...row, to: e.currentTarget.value };
                      form.setFieldValue('redirect_rules', next);
                    }
                  }}
                  placeholder="/new"
                  style={{ flex: 1 }}
                />
                <NumberInput
                  label={i === 0 ? 'Status' : undefined}
                  value={rule.status}
                  onChange={(v) => {
                    const next = [...form.values.redirect_rules];
                    const row = next[i];
                    if (row) {
                      const numValue = typeof v === 'number' ? v : Number(v);
                      const statusCandidate: RedirectStatus = (
                        [301, 302, 307, 308] as const
                      ).includes(numValue as RedirectStatus)
                        ? (numValue as RedirectStatus)
                        : 301;
                      next[i] = { ...row, status: statusCandidate };
                      form.setFieldValue('redirect_rules', next);
                    }
                  }}
                  min={300}
                  max={399}
                  w={90}
                />
                <ActionIcon
                  color="red.8"
                  variant="subtle"
                  onClick={() => {
                    removeRedirect(i);
                  }}
                  aria-label={`Remove redirect ${String(i + 1)}`}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Group>
            ))}
          </Stack>
        )}

        {form.values.tls_mode === 'manual' && (
          <Alert color="blue" variant="light">
            Manual TLS certificates cannot be changed via the edit form. Delete and re-create the
            site with new PEMs to rotate the certificate.
          </Alert>
        )}

        <Group justify="flex-end" gap="sm">
          <Button variant="default" onClick={onCancel} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={loading}>
            Save changes
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
