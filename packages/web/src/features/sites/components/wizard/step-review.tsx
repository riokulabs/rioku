/**
 * Wizard step 5 — Review.
 *
 * Read-only summary of all values gathered in the prior steps.
 */
import { Badge, Divider, Group, Stack, Text, Title } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { WizardFormValues } from './index';

interface StepReviewProps {
  form: UseFormReturnType<WizardFormValues>;
  serviceOptions: { value: string; label: string }[];
}

function formatUpstream(v: WizardFormValues): string {
  if (v.upstream_mode === 'existing_service') {
    return v.upstream_service_id ? `service:${v.upstream_service_id}` : '(none)';
  }
  const base = `${v.upstream_protocol}://${v.upstream_host}`;
  return typeof v.upstream_port === 'number' ? `${base}:${String(v.upstream_port)}` : base;
}

export function StepReview({ form, serviceOptions }: StepReviewProps) {
  const v = form.values;
  const serviceLabel =
    v.upstream_mode === 'existing_service'
      ? (serviceOptions.find((o) => o.value === v.upstream_service_id)?.label ??
        v.upstream_service_id)
      : formatUpstream(v);

  return (
    <Stack gap="md" mt="md">
      <Title order={5}>Review & confirm</Title>

      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Hostname
        </Text>
        <Group gap="xs">
          <Text size="sm" ff="monospace">
            {v.domain}
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            ({v.name})
          </Text>
        </Group>
      </Stack>

      <Divider />

      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Upstream
        </Text>
        <Text size="sm" ff="monospace" data-testid="review-upstream">
          {serviceLabel}
        </Text>
      </Stack>

      <Divider />

      <Stack gap={4}>
        <Text size="sm" fw={600}>
          TLS
        </Text>
        <Badge
          size="sm"
          color={v.tls_mode === 'auto' ? 'green' : v.tls_mode === 'manual' ? 'teal' : 'gray'}
          variant="light"
        >
          TLS {v.tls_mode}
        </Badge>
        {v.tls_mode === 'manual' && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            cert preview: {v.tls_manual_cert_pem.slice(0, 48)}…
          </Text>
        )}
      </Stack>

      <Divider />

      <Stack gap={4}>
        <Text size="sm" fw={600}>
          Policies
        </Text>
        <Group gap="xs">
          <Badge size="sm" variant="light" color={v.basic_auth_enabled ? 'indigo' : 'gray'}>
            Basic auth: {v.basic_auth_enabled ? 'on' : 'off'}
          </Badge>
          <Badge size="sm" variant="light" color="orange">
            Rate limit: {v.rate_limit_preset}
          </Badge>
          <Badge size="sm" variant="light" color="gray">
            {String(v.redirect_rules.length)} redirect
            {v.redirect_rules.length === 1 ? '' : 's'}
          </Badge>
        </Group>
      </Stack>
    </Stack>
  );
}
