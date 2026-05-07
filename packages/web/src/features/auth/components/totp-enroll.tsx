/**
 * <TotpEnrollForm> — multi-step TOTP enrollment for an authenticated user.
 *
 * Real-daemon flow (different from the stage-1 mock flow):
 *   Step 1 — secret  : POST /auth/totp/setup → returns {secret, qrUri}
 *   Step 2 — confirm : POST /auth/totp/verify with 6-digit code → returns
 *                       backup codes; daemon flips totp_enabled=true
 *   Step 3 — backup-codes : display the codes returned by step 2 and let the
 *                            user download them before navigating away.
 *
 * The order differs from the stage-1 mock (codes-before-confirm) because the
 * daemon does not generate backup codes until after a successful verify.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useState, useEffect } from 'react';
import {
  Stack,
  Text,
  Code,
  Button,
  Group,
  Alert,
  PinInput,
  Title,
  CopyButton,
  Tooltip,
  ActionIcon,
  List,
  Paper,
} from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { IconAlertCircle, IconCheck, IconCopy } from '@tabler/icons-react';
import { enrollTotp, confirmTotpEnrollment } from '../api';
import { consumeReturnUrl } from '@/api/auth-failure';
import { currentUserQueryKey } from '../use-current-user';

interface TotpEnrollFormProps {
  userId?: string | undefined;
  returnUrl?: string | undefined;
}

type Step = 'secret' | 'confirm' | 'backup-codes';

export function TotpEnrollForm({ userId, returnUrl }: TotpEnrollFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState<Step>('secret');
  const [secret, setSecret] = useState<string | null>(null);
  const [qrUri, setQrUri] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    enrollTotp(userId)
      .then((result) => {
        if (cancelled) return;
        setSecret(result.secret);
        setQrUri(result.qr_url);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSetupError(err instanceof Error ? err.message : 'Failed to start TOTP setup');
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleConfirm(code: string) {
    if (!/^\d{6}$/.test(code)) {
      setConfirmError('Enter the 6-digit code from your authenticator');
      return;
    }
    setConfirming(true);
    setConfirmError(null);

    try {
      const result = await confirmTotpEnrollment(userId ?? '', code);
      if (!result.ok) {
        setConfirmError(result.error ?? 'Invalid code');
        return;
      }
      setBackupCodes(result.backup_codes ?? []);
      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      setStep('backup-codes');
    } finally {
      setConfirming(false);
    }
  }

  function handleConfirmChange(value: string) {
    setConfirmCode(value);
    if (value.length === 6) {
      void handleConfirm(value);
    }
  }

  function downloadBackupCodes() {
    if (backupCodes.length === 0) return;
    const text = backupCodes.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rioku-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFinish() {
    const saved = consumeReturnUrl();
    const dest = saved ?? returnUrl ?? '/';
    await navigate({ to: dest });
  }

  if (loading) {
    return <Text>Loading enrollment…</Text>;
  }

  if (setupError) {
    return (
      <Alert
        icon={<IconAlertCircle size={16} />}
        color="red"
        variant="light"
        data-testid="totp-setup-error"
      >
        {setupError}
      </Alert>
    );
  }

  if (step === 'secret' && secret !== null && qrUri !== null) {
    return (
      <Stack gap="md">
        <Text size="sm">
          Open your authenticator app (Google Authenticator, Authy, 1Password, etc.) and add a new
          account. You can either scan a QR code or enter the setup key manually.
        </Text>

        <Stack gap="xs">
          <Text fw={500} size="sm">
            Setup key (manual entry)
          </Text>
          <Group gap="xs" align="center">
            <Code fz="md" data-testid="totp-secret">
              {secret}
            </Code>
            <CopyButton value={secret} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied!' : 'Copy key'} withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={copy}
                    aria-label="Copy secret key"
                    data-testid="copy-secret"
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        </Stack>

        <Stack gap="xs">
          <Text fw={500} size="sm">
            Or paste this URL into your authenticator:
          </Text>
          <Code block fz="xs" data-testid="totp-qr-url" style={{ wordBreak: 'break-all' }}>
            {qrUri}
          </Code>
        </Stack>

        <Button
          onClick={() => {
            setStep('confirm');
          }}
          fullWidth
          data-testid="totp-next-confirm"
        >
          I&apos;ve added the account — confirm
        </Button>
      </Stack>
    );
  }

  if (step === 'confirm') {
    return (
      <Stack gap="md" align="center">
        <Title order={4}>Confirm your authenticator works</Title>
        <Text size="sm" ta="center">
          Enter the 6-digit code shown in your authenticator app to complete enrollment. Backup
          codes will be displayed after this step.
        </Text>

        {confirmError && (
          <Alert
            icon={<IconAlertCircle size={16} />}
            color="red"
            variant="light"
            w="100%"
            data-testid="confirm-error"
          >
            {confirmError}
          </Alert>
        )}

        <PinInput
          length={6}
          type="number"
          value={confirmCode}
          onChange={handleConfirmChange}
          disabled={confirming}
          data-autofocus
          data-testid="confirm-pin-input"
          oneTimeCode
          aria-label="Confirmation code"
        />

        <Button
          onClick={() => void handleConfirm(confirmCode)}
          loading={confirming}
          disabled={confirmCode.length !== 6}
          fullWidth
          data-testid="totp-complete-setup"
        >
          Complete setup
        </Button>
      </Stack>
    );
  }

  // step === 'backup-codes'
  return (
    <Stack gap="md">
      <Alert color="green" variant="light">
        Two-factor authentication is now enabled.
      </Alert>

      <Alert color="yellow" variant="light">
        <Text fw={600} size="sm">
          Save your backup codes
        </Text>
        <Text size="sm" mt={4}>
          If you lose access to your authenticator, these codes are the only way to recover your
          account. Each code can only be used once.
        </Text>
      </Alert>

      <Paper withBorder p="md" data-testid="backup-codes-list">
        <List spacing="xs" styles={{ itemWrapper: { fontFamily: 'monospace', fontSize: 14 } }}>
          {backupCodes.map((code) => (
            <List.Item key={code}>{code}</List.Item>
          ))}
        </List>
      </Paper>

      <Button variant="outline" onClick={downloadBackupCodes} data-testid="download-backup">
        Download backup codes
      </Button>

      <Button onClick={() => void handleFinish()} fullWidth data-testid="totp-finish">
        I&apos;ve saved my codes — finish
      </Button>
    </Stack>
  );
}
