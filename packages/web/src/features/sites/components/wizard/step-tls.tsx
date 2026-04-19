/**
 * Wizard step 3 — TLS.
 *
 * Radio group: auto / manual / off. Manual shows two PEM textareas.
 */
import { Radio, Stack, Text, Textarea } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { WizardFormValues } from './index';

interface StepTlsProps {
  form: UseFormReturnType<WizardFormValues>;
}

export function StepTls({ form }: StepTlsProps) {
  return (
    <Stack gap="md" mt="md">
      <Radio.Group
        value={form.values.tls_mode}
        onChange={(v: string) => {
          if (v === 'auto' || v === 'manual' || v === 'off') {
            form.setFieldValue('tls_mode', v);
          }
        }}
      >
        <Stack gap="xs">
          <Radio
            value="auto"
            label="Auto (Let's Encrypt)"
            description="Rioku automatically provisions and renews a certificate."
          />
          <Radio
            value="manual"
            label="Manual certificate"
            description="Paste your own PEM-encoded certificate and private key."
          />
          <Radio
            value="off"
            label="Off (plaintext only)"
            description="Serve this site without HTTPS."
          />
        </Stack>
      </Radio.Group>

      {form.values.tls_mode === 'manual' && (
        <Stack gap="sm">
          <Text size="sm" fw={500}>
            Certificate
          </Text>
          <Textarea
            label="Certificate PEM"
            minRows={4}
            autosize
            placeholder="-----BEGIN CERTIFICATE-----"
            required
            {...form.getInputProps('tls_manual_cert_pem')}
          />
          <Textarea
            label="Private key PEM"
            minRows={4}
            autosize
            placeholder="-----BEGIN PRIVATE KEY-----"
            required
            {...form.getInputProps('tls_manual_key_pem')}
          />
        </Stack>
      )}
    </Stack>
  );
}
