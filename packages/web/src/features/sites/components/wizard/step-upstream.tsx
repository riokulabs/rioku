/**
 * Wizard step 2 — Upstream.
 *
 * SegmentedControl picks between "reuse existing service" and "point at new
 * upstream". Conditional fields render based on the selection.
 */
import {
  Alert,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { IconInfoCircle } from '@tabler/icons-react';
import type { UseFormReturnType } from '@mantine/form';
import type { WizardFormValues } from './index';

interface StepUpstreamProps {
  form: UseFormReturnType<WizardFormValues>;
  serviceOptions: { value: string; label: string }[];
}

export function StepUpstream({ form, serviceOptions }: StepUpstreamProps) {
  return (
    <Stack gap="md" mt="md">
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          Upstream source
        </Text>
        <SegmentedControl
          data={[
            { value: 'existing_service', label: 'Reuse existing service' },
            { value: 'new_upstream', label: 'Point at new upstream' },
          ]}
          value={form.values.upstream_mode}
          onChange={(v: string) => {
            if (v === 'existing_service' || v === 'new_upstream') {
              form.setFieldValue('upstream_mode', v);
            }
          }}
        />
      </Stack>

      {form.values.upstream_mode === 'existing_service' ? (
        serviceOptions.length === 0 ? (
          <Alert color="yellow" variant="light" icon={<IconInfoCircle size={16} />}>
            No services exist in this tenant yet. Switch to &ldquo;Point at new upstream&rdquo; to
            create one.
          </Alert>
        ) : (
          <Select
            label="Service"
            data={serviceOptions}
            required
            searchable
            allowDeselect={false}
            {...form.getInputProps('upstream_service_id')}
          />
        )
      ) : (
        <Stack gap="md">
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Protocol
            </Text>
            <SegmentedControl
              data={[
                { value: 'http', label: 'HTTP' },
                { value: 'https', label: 'HTTPS' },
                { value: 'grpc', label: 'gRPC' },
              ]}
              value={form.values.upstream_protocol}
              onChange={(v: string) => {
                if (v === 'http' || v === 'https' || v === 'grpc') {
                  form.setFieldValue('upstream_protocol', v);
                }
              }}
            />
          </Stack>
          <TextInput
            label="Host"
            placeholder="backend.internal"
            required
            {...form.getInputProps('upstream_host')}
          />
          <NumberInput
            label="Port"
            placeholder="8080"
            min={1}
            max={65535}
            value={form.values.upstream_port}
            onChange={(v) => {
              if (typeof v === 'number') {
                form.setFieldValue('upstream_port', v);
              } else if (v === '') {
                form.setFieldValue('upstream_port', '');
              } else {
                const n = Number(v);
                form.setFieldValue('upstream_port', Number.isNaN(n) ? '' : n);
              }
            }}
            error={form.errors.upstream_port as string | undefined}
          />
          <Alert variant="light" icon={<IconInfoCircle size={16} />}>
            Rioku will create a service linked to this site automatically.
          </Alert>
        </Stack>
      )}
    </Stack>
  );
}
