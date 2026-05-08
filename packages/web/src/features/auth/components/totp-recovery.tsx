/**
 * <TotpRecoveryForm> — backup-code login.
 *
 * Calls `verifyBackupCode(code)` which routes through `/auth/login` with the
 * code in the totpCode field; daemon's tryBackupCode burns the matching code.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useState } from 'react';
import { Stack, TextInput, Button, Alert, Anchor, Text, Notification } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { IconAlertCircle, IconCheck } from '@tabler/icons-react';
import { verifyBackupCode } from '../api';
import { backupCodeSchema, type BackupCodeFormValues } from '../schemas';
import { consumeReturnUrl } from '@/api/auth-failure';
import { currentUserQueryKey } from '../use-current-user';

interface TotpRecoveryFormProps {
  returnUrl?: string | undefined;
}

export function TotpRecoveryForm({ returnUrl }: TotpRecoveryFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const form = useForm<BackupCodeFormValues>({
    validate: schemaResolver(backupCodeSchema, { sync: true }),
    initialValues: { code: '' },
  });

  async function handleSubmit(values: BackupCodeFormValues) {
    setSubmitting(true);
    setError(null);
    setSuccess(false);

    try {
      const result = await verifyBackupCode(values.code.trim().toUpperCase());

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setSuccess(true);
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      await new Promise<void>((resolve) => setTimeout(resolve, 1200));

      const saved = consumeReturnUrl();
      const dest = saved ?? returnUrl ?? '/';
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

        {success && (
          <Notification
            icon={<IconCheck size={18} />}
            color="green"
            title="Backup code accepted"
            withCloseButton={false}
            data-testid="recovery-success"
          >
            Signing you in…
          </Notification>
        )}

        <Text size="sm">Enter one of your backup codes. Each code can only be used once.</Text>

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

        <Button type="submit" loading={submitting} fullWidth data-testid="recovery-submit">
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
