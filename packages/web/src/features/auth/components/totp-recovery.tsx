/**
 * <TotpRecoveryForm> — backup-code login.
 * Task 1e.87
 */
import { useState } from 'react';
import {
  Stack,
  TextInput,
  Button,
  Alert,
  Anchor,
  Text,
  Notification,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { verifyBackupCode } from '../api';
import { backupCodeSchema, type BackupCodeFormValues } from '../schemas';
import { consumeReturnUrl } from '@/api/auth-failure';

interface TotpRecoveryFormProps {
  returnUrl?: string | undefined;
}

export function TotpRecoveryForm({ returnUrl }: TotpRecoveryFormProps) {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successInfo, setSuccessInfo] = useState<{ remaining: number } | null>(null);

  const form = useForm<BackupCodeFormValues>({
    validate: schemaResolver(backupCodeSchema, { sync: true }),
    initialValues: { code: '' },
  });

  async function handleSubmit(values: BackupCodeFormValues) {
    setSubmitting(true);
    setError(null);
    setSuccessInfo(null);

    try {
      const result = await verifyBackupCode(values.code.trim().toUpperCase());

      if (!result.ok) {
        setError(result.error);
        return;
      }

      // Show remaining count briefly, then navigate.
      setSuccessInfo({ remaining: result.remaining });

      await new Promise<void>((resolve) => setTimeout(resolve, 1500));

      const saved = consumeReturnUrl();
      const dest = saved ?? returnUrl ?? `/t/${result.tenant_id}/dashboard`;
      await navigate({ to: dest });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
      <Stack gap="md">
        {error && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            data-testid="recovery-error"
          >
            {error}
          </Alert>
        )}

        {successInfo && (
          <Notification
            icon={<IconCheck size={18} />}
            color="green"
            title="Backup code used"
            withCloseButton={false}
            data-testid="recovery-success"
          >
            1 backup code used — {successInfo.remaining} code
            {successInfo.remaining === 1 ? '' : 's'} remaining. Consider
            regenerating your backup codes in Security settings.
          </Notification>
        )}

        <Text size="sm">
          Enter one of your 10-character backup codes. Each code can only be used once.
        </Text>

        <TextInput
          label="Backup code"
          placeholder="XXXXXXXXXX"
          autoComplete="one-time-code"
          data-autofocus
          required
          data-testid="backup-code-input"
          styles={{ input: { fontFamily: 'monospace', letterSpacing: '0.1em' } }}
          {...form.getInputProps('code')}
        />

        <Button type="submit" loading={submitting} fullWidth>
          Use backup code
        </Button>

        <Text size="sm" ta="center">
          <Anchor href="/totp" size="sm" data-testid="try-totp-link">
            Try TOTP code instead
          </Anchor>
        </Text>
      </Stack>
    </form>
  );
}
