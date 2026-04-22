/**
 * <ApiKeyCreateDrawer> — form to create a new API key.
 *
 * Flow:
 *   Step 1: Fill in name, scope, optional expiration → submit
 *   Step 2: Show the generated full key value (copy block + warning)
 */
import { useState } from 'react';
import {
  Stack,
  Text,
  Button,
  TextInput,
  Group,
  Alert,
  Code,
  Divider,
  CopyButton,
  ActionIcon,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconCheck, IconCopy } from '@tabler/icons-react';
import { PermissionSelector } from '@/components/permission-selector';
import { notify } from '@/hooks/use-notify';
import { createApiKey } from '../api';
import { createApiKeySchema, type CreateApiKeyFormValues } from '../schemas';

interface ApiKeyCreateDrawerProps {
  tenantId: string;
  onSuccess: () => void;
  onCancel: () => void;
}

export function ApiKeyCreateDrawer({ tenantId, onSuccess, onCancel }: ApiKeyCreateDrawerProps) {
  const [step, setStep] = useState<'form' | 'created'>('form');
  const [fullKeyValue, setFullKeyValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateApiKeyFormValues>({
    initialValues: {
      name: '',
      scope: [],
      expires_at: undefined,
    },
    validate: schemaResolver(createApiKeySchema),
  });

  async function handleSubmit(values: CreateApiKeyFormValues) {
    setSubmitting(true);
    try {
      const result = await createApiKey(
        tenantId,
        values.name,
        values.scope,
        values.expires_at ?? undefined,
      );
      setFullKeyValue(result.fullValue);
      setStep('created');
    } catch {
      notify.error('Failed to create API key', 'Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (step === 'created') {
    return (
      <Stack gap="md">
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="yellow"
          variant="light"
          title="Save this now"
        >
          This is the only time you will see the full key value. Copy it before closing.
        </Alert>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Your new API key
          </Text>
          <Group gap="xs" align="center">
            <Code
              block
              style={{ flex: 1, wordBreak: 'break-all', fontSize: 13 }}
              data-testid="api-key-full-value"
            >
              {fullKeyValue}
            </Code>
            <CopyButton value={fullKeyValue} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied!' : 'Copy'} withArrow>
                  <ActionIcon
                    color={copied ? 'teal' : 'blue'}
                    variant="light"
                    onClick={copy}
                    aria-label="Copy API key"
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        </Stack>

        <Divider />

        <Button onClick={onSuccess}>Done</Button>
      </Stack>
    );
  }

  return (
    <Stack gap="md">
      <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
        <Stack gap="md">
          <TextInput
            label="Name"
            placeholder="e.g. ci-deploy, mobile-app"
            required
            {...form.getInputProps('name')}
          />

          <PermissionSelector
            label="Scope (permissions)"
            value={form.values.scope}
            onChange={(v) => {
              form.setFieldValue('scope', v);
            }}
          />
          {form.errors.scope && (
            <Text size="xs" c="red">
              {form.errors.scope}
            </Text>
          )}

          <DatePickerInput
            label="Expires at (optional)"
            placeholder="No expiration"
            clearable
            minDate={new Date()}
            value={form.values.expires_at ? new Date(form.values.expires_at) : null}
            onChange={(d) => {
              form.setFieldValue('expires_at', d ? new Date(d).toISOString() : undefined);
            }}
          />

          <Group justify="flex-end" gap="sm" mt="sm">
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Create key
            </Button>
          </Group>
        </Stack>
      </form>
    </Stack>
  );
}
