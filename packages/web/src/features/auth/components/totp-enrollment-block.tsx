/**
 * <TotpEnrollmentBlock> — inline TOTP enrollment widget used by:
 *   - <InviteAcceptanceForm> (Task 1e.89)
 *   - <BootstrapForm> (Task 1e.90)
 *   - (Optionally refactored into <TotpEnrollForm>)
 *
 * Unlike the standalone <TotpEnrollForm>, this component exposes a callback
 * on completion instead of navigating, so the parent form can include it
 * as part of a larger submit flow.
 *
 * Task 1e.89
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
  CopyButton,
  Tooltip,
  ActionIcon,
  List,
  Paper,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconCopy } from '@tabler/icons-react';
import { enrollTotp, confirmTotpEnrollment } from '../api';
import type { TotpEnrollment } from '../types';

export interface TotpEnrollmentBlockProps {
  /** The user ID to enroll. */
  userId: string;
  /**
   * Called when enrollment is complete (user confirmed the code).
   * Receives the enrollment payload so the parent can store totp_secret + backup_codes.
   */
  onComplete: (enrollment: TotpEnrollment, code: string) => void | Promise<void>;
}

type Step = 'secret' | 'backup-codes' | 'confirm';

export function TotpEnrollmentBlock({ userId, onComplete }: TotpEnrollmentBlockProps) {
  const [step, setStep] = useState<Step>('secret');
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirmCode, setConfirmCode] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    enrollTotp(userId)
      .then((result) => {
        if (!cancelled) {
          setEnrollment(result);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          console.error('enrollTotp error', err);
          setLoading(false);
        }
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
    if (!enrollment) return;

    setConfirming(true);
    setConfirmError(null);

    try {
      const result = await confirmTotpEnrollment(userId, code);
      if (!result.ok) {
        setConfirmError(result.error ?? 'Invalid code');
        return;
      }
      await onComplete(enrollment, code);
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
    if (!enrollment) return;
    const text = enrollment.backup_codes.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rioku-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  if (!userId) {
    return (
      <Alert color="orange" variant="light">
        User session not found. Cannot start TOTP enrollment.
      </Alert>
    );
  }

  if (loading || !enrollment) {
    return <Text>Setting up authenticator…</Text>;
  }

  // ── Step 1: Secret ──────────────────────────────────────────────────────────

  if (step === 'secret') {
    return (
      <Stack gap="md">
        <Text size="sm">
          Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)
          and add a new account using the setup key or URL below.
        </Text>

        <Stack gap="xs">
          <Text fw={500} size="sm">
            Setup key (manual entry)
          </Text>
          <Group gap="xs" align="center">
            <Code fz="md" data-testid="enroll-block-secret">
              {enrollment.secret}
            </Code>
            <CopyButton value={enrollment.secret} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied!' : 'Copy key'} withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={copy}
                    aria-label="Copy secret key"
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
          <Code block fz="xs" data-testid="enroll-block-qr-url" style={{ wordBreak: 'break-all' }}>
            {enrollment.qr_url}
          </Code>
          <CopyButton value={enrollment.qr_url} timeout={2000}>
            {({ copied, copy }) => (
              <Button
                variant="subtle"
                size="xs"
                leftSection={copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                onClick={copy}
              >
                {copied ? 'Copied!' : 'Copy URL'}
              </Button>
            )}
          </CopyButton>
        </Stack>

        <Button onClick={() => { setStep('backup-codes'); }} fullWidth data-testid="enroll-block-next-to-codes">
          I&apos;ve added the account — next
        </Button>
      </Stack>
    );
  }

  // ── Step 2: Backup codes ────────────────────────────────────────────────────

  if (step === 'backup-codes') {
    return (
      <Stack gap="md">
        <Alert color="yellow" variant="light">
          <Text fw={600} size="sm">
            Save your backup codes
          </Text>
          <Text size="sm" mt={4}>
            If you lose access to your authenticator, these codes are the only way
            to recover your account. Each code can only be used once.
          </Text>
        </Alert>

        <Paper withBorder p="md" bg="dark.8" data-testid="enroll-block-backup-codes">
          <List
            spacing="xs"
            styles={{ itemWrapper: { fontFamily: 'monospace', fontSize: 14 } }}
          >
            {enrollment.backup_codes.map((code) => (
              <List.Item key={code}>{code}</List.Item>
            ))}
          </List>
        </Paper>

        <Button variant="outline" onClick={downloadBackupCodes} data-testid="enroll-block-download">
          Download backup codes
        </Button>

        <Button onClick={() => { setStep('confirm'); }} fullWidth data-testid="enroll-block-next-to-confirm">
          I&apos;ve saved my codes — next
        </Button>
      </Stack>
    );
  }

  // ── Step 3: Confirmation ────────────────────────────────────────────────────

  return (
    <Stack gap="md" align="center">
      <Title order={4}>Confirm your authenticator works</Title>
      <Text size="sm" ta="center">
        Enter the 6-digit code currently shown in your authenticator app.
      </Text>

      {confirmError && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          w="100%"
          data-testid="enroll-block-confirm-error"
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
        data-testid="enroll-block-pin-input"
        oneTimeCode
        aria-label="Confirmation code"
      />

      <Button
        onClick={() => void handleConfirm(confirmCode)}
        loading={confirming}
        disabled={confirmCode.length !== 6}
        fullWidth
        data-testid="enroll-block-complete"
      >
        Complete setup
      </Button>
    </Stack>
  );
}
