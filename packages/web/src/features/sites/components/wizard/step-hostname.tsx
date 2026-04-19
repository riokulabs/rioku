/**
 * Wizard step 1 — Hostname.
 *
 * Captures the site name and domain.
 */
import { Stack, TextInput } from '@mantine/core';
import type { UseFormReturnType } from '@mantine/form';
import type { WizardFormValues } from './index';

interface StepHostnameProps {
  form: UseFormReturnType<WizardFormValues>;
}

export function StepHostname({ form }: StepHostnameProps) {
  return (
    <Stack gap="md" mt="md">
      <TextInput
        label="Site name"
        placeholder="marketing-site"
        required
        description="Short internal name shown throughout the admin."
        {...form.getInputProps('name')}
      />
      <TextInput
        label="Domain"
        placeholder="www.example.com"
        required
        description="The public hostname Rioku will serve on."
        {...form.getInputProps('domain')}
      />
    </Stack>
  );
}
