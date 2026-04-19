/**
 * <TotpEnrollForm> — multi-step TOTP enrollment.
 *
 * Step 1: Display secret + otpauth:// URL (URL-text approach, no QR lib).
 * Step 2: Display 10 backup codes + download.
 * Step 3: Confirmation code entry to prove enrollment works.
 *
 * Task 1e.86
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
import { IconAlertCircle, IconCheck, IconCopy } from '@tabler/icons-react';
import { enrollTotp, confirmTotpEnrollment } from '../api';
import { useMockStore } from '@/api/mock-store';
import { consumeReturnUrl } from '@/api/auth-failure';

interface TotpEnrollFormProps {
  userId?: string | undefined;
  returnUrl?: string | undefined;
}

type Step = 'secret' | 'backup-codes' | 'confirm';

export function TotpEnrollForm({ userId: propUserId, returnUrl }: TotpEnrollFormProps) {
  const navigate = useNavigate();
  const currentUserId = useMockStore((s) => s.currentUserId);
  const userId = propUserId ?? currentUserId ?? '';

  const [step, setStep] = useState<Step>('secret');
  const [enrollment, setEnrollment] = useState<{
    secret: string;
    qr_url: string;
    backup_codes: string[];
  } | null>(null);
  const [loading, setLoading] = useState(userId !== '');
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

    setConfirming(true);
    setConfirmError(null);

    try {
      const result = await confirmTotpEnrollment(userId, code);
      if (!result.ok) {
        setConfirmError(result.error ?? 'Invalid code');
        return;
      }

      const saved = consumeReturnUrl();
      const tenantId = useMockStore.getState().currentTenantId ?? '';
      const dest = saved ?? returnUrl ?? `/t/${tenantId}/dashboard`;
      await navigate({ to: dest });
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
        User session not found. Please sign in first.
      </Alert>
    );
  }

  if (loading || !enrollment) {
    return <Text c="dimmed">Loading enrollment…</Text>;
  }

  // ── Step 1: Secret ────────────────────────────────────────────────────────

  if (step === 'secret') {
    return (
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Open your authenticator app (Google Authenticator, Authy, 1Password, etc.)
          and add a new account. You can either scan a QR code or enter the setup
          key manually.
        </Text>

        <Stack gap="xs">
          <Text fw={500} size="sm">
            Setup key (manual entry)
          </Text>
          <Group gap="xs" align="center">
            <Code fz="md" data-testid="totp-secret">
              {enrollment.secret}
            </Code>
            <CopyButton value={enrollment.secret} timeout={2000}>
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

        <Button onClick={() => { setStep('backup-codes'); }} fullWidth>
          I&apos;ve added the account — next
        </Button>
      </Stack>
    );
  }

  // ── Step 2: Backup codes ──────────────────────────────────────────────────

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

        <Paper withBorder p="md" bg="dark.8" data-testid="backup-codes-list">
          <List
            spacing="xs"
            styles={{ itemWrapper: { fontFamily: 'monospace', fontSize: 14 } }}
          >
            {enrollment.backup_codes.map((code) => (
              <List.Item key={code}>{code}</List.Item>
            ))}
          </List>
        </Paper>

        <Button variant="outline" onClick={downloadBackupCodes} data-testid="download-backup">
          Download backup codes
        </Button>

        <Button onClick={() => { setStep('confirm'); }} fullWidth>
          I&apos;ve saved my codes — next
        </Button>
      </Stack>
    );
  }

  // ── Step 3: Confirmation ──────────────────────────────────────────────────

  return (
    <Stack gap="md" align="center">
      <Title order={4}>Confirm your authenticator works</Title>
      <Text size="sm" c="dimmed" ta="center">
        Enter the 6-digit code currently shown in your authenticator app to
        complete enrollment.
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
      >
        Complete setup
      </Button>
    </Stack>
  );
}
