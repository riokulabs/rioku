/**
 * Wizard step 4 — Policies.
 *
 * basic_auth Switch + rate_limit_preset Select + redirect_rules dynamic list.
 */
import {
  ActionIcon,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { UseFormReturnType } from '@mantine/form';
import type { RedirectStatus, WizardFormValues } from './index';

interface StepPoliciesProps {
  form: UseFormReturnType<WizardFormValues>;
}

const REDIRECT_STATUSES: readonly RedirectStatus[] = [301, 302, 307, 308];

export function StepPolicies({ form }: StepPoliciesProps) {
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

  return (
    <Stack gap="md" mt="md">
      <Switch
        label="Enable HTTP basic authentication"
        description="Prompt browsers for credentials before reaching the upstream."
        checked={form.values.basic_auth_enabled}
        onChange={(e) => {
          form.setFieldValue('basic_auth_enabled', e.currentTarget.checked);
        }}
      />

      <Select
        label="Rate limit preset"
        description="Built-in presets — fine-grained control available per-route."
        data={[
          { value: 'none', label: 'None' },
          { value: 'lenient', label: 'Lenient (1000 req/min)' },
          { value: 'standard', label: 'Standard (100 req/min)' },
          { value: 'strict', label: 'Strict (10 req/min)' },
        ]}
        allowDeselect={false}
        {...form.getInputProps('rate_limit_preset')}
      />

      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={500}>
            Redirect rules
          </Text>
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
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No redirect rules — add one to rewrite URLs on this site.
          </Text>
        ) : (
          <Stack gap="xs">
            {form.values.redirect_rules.map((rule, i) => (
              <Group key={`wiz-redirect-${String(i)}`} gap="xs" align="flex-end" wrap="nowrap">
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
                    if (!row) return;
                    const numValue = typeof v === 'number' ? v : Number(v);
                    const statusCandidate = (REDIRECT_STATUSES as readonly number[]).includes(
                      numValue,
                    )
                      ? (numValue as RedirectStatus)
                      : 301;
                    next[i] = { ...row, status: statusCandidate };
                    form.setFieldValue('redirect_rules', next);
                  }}
                  min={300}
                  max={399}
                  w={90}
                />
                <ActionIcon
                  color="red"
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
      </Stack>
    </Stack>
  );
}
