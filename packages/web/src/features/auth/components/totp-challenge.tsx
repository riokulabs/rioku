/**
 * <TotpChallengeForm> — second step of two-factor login.
 *
 * Reads the in-memory pending-credentials slot maintained by `api.ts`.
 * On submit, calls `verifyTotp(code)` which re-issues `/auth/login` with
 * the saved username/password plus the supplied totpCode. Daemon falls back
 * to backup codes automatically.
 *
 * Plan 01 — stage 2 wiring.
 */
import { useState, useRef, useEffect } from 'react';
import { Stack, Text, Alert, Anchor, PinInput, Group, Button } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { IconAlertCircle } from '@tabler/icons-react';
import { verifyTotp, getPendingAuthUserId } from '../api';
import { consumeReturnUrl } from '@/api/auth-failure';
import { currentUserQueryKey } from '../use-current-user';

const MAX_ATTEMPTS = 5;

interface TotpChallengeFormProps {
  userId?: string | undefined;
  returnUrl?: string | undefined;
}

export function TotpChallengeForm({ userId: _userId, returnUrl }: TotpChallengeFormProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  const [pendingUserId, setPendingUserId] = useState<string | null>(getPendingAuthUserId());

  // Re-read the pending slot on focus changes (in case user navigated away
  // and back). The slot is in-memory only, no subscription mechanism.
  useEffect(() => {
    const handler = () => {
      setPendingUserId(getPendingAuthUserId());
    };
    window.addEventListener('focus', handler);
    return () => {
      window.removeEventListener('focus', handler);
    };
  }, []);

  async function handleSubmit(value: string) {
    if (locked || submitting) return;
    if (!/^\d{6}$/.test(value)) {
      setError('Enter a 6-digit code');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await verifyTotp(value);

      if (!result.ok) {
        const nextAttempts = attempts + 1;
        setAttempts(nextAttempts);
        setCode('');
        if (nextAttempts >= MAX_ATTEMPTS) {
          setLocked(true);
          setError(
            'Too many failed attempts. For security, please start the login process again.',
          );
        } else {
          setError(
            `Invalid code — try again (${String(MAX_ATTEMPTS - nextAttempts)} attempt${MAX_ATTEMPTS - nextAttempts === 1 ? '' : 's'} remaining)`,
          );
        }
        return;
      }

      await queryClient.invalidateQueries({ queryKey: currentUserQueryKey });
      const saved = consumeReturnUrl();
      const dest = saved ?? returnUrl ?? '/';
      await navigate({ to: dest });
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(value: string) {
    setCode(value);
    if (value.length === 6) {
      void handleSubmit(value);
    }
  }

  if (!pendingUserId && !_userId) {
    return (
      <Stack gap="md">
        <Alert color="orange" variant="light">
          No pending authentication session. Please <Anchor href="/login">sign in again</Anchor>.
        </Alert>
      </Stack>
    );
  }

  return (
    <Stack gap="md" align="center">
      <Text size="sm" ta="center">
        Enter the 6-digit code from your authenticator app.
      </Text>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          w="100%"
          data-testid="totp-error"
        >
          {error}
        </Alert>
      )}

      <PinInput
        ref={pinRef}
        length={6}
        type="number"
        value={code}
        onChange={handleChange}
        disabled={submitting || locked}
        data-autofocus
        data-testid="totp-pin-input"
        oneTimeCode
        aria-label="6-digit TOTP code"
      />

      {submitting && <Text size="xs">Verifying…</Text>}

      <Group justify="center" gap="xs">
        <Anchor href="/totp-recovery" size="sm" data-testid="use-backup-link">
          Use a backup code instead
        </Anchor>
        {locked && (
          <>
            {' · '}
            <Anchor href="/login" size="sm">
              Back to sign in
            </Anchor>
          </>
        )}
      </Group>

      {!locked && (
        <Button
          variant="subtle"
          size="xs"
          onClick={() => void handleSubmit(code)}
          disabled={code.length !== 6 || submitting}
          loading={submitting}
        >
          Verify
        </Button>
      )}
    </Stack>
  );
}
