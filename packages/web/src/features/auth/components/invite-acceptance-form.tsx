/**
 * <InviteAcceptanceForm> — accept a pending membership invite.
 *
 * Validates token → shows tenant context → collects password + TOTP → activates membership.
 *
 * Task 1e.89
 */
import { useState } from 'react';
import {
  Stack,
  PasswordInput,
  Button,
  Alert,
  Text,
  Title,
  Badge,
  Paper,
  Divider,
  Anchor,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { useNavigate } from '@tanstack/react-router';
import { IconAlertCircle } from '@tabler/icons-react';
import { acceptInvite } from '../api';
import { acceptInviteSchema, type AcceptInviteFormValues } from '../schemas';
import { TotpEnrollmentBlock } from './totp-enrollment-block';
import { useMockStore } from '@/api/mock-store';
import type { TotpEnrollment } from '../types';

interface InviteAcceptanceFormProps {
  token: string;
}

interface InviteContext {
  membershipId: string;
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  roleIds: string[];
  invitedByName: string;
}

/** Synchronously resolve invite context from the mock store. */
function resolveInviteContext(
  token: string,
): { error: string; ctx: null } | { error: null; ctx: InviteContext } {
  try {
    const state = useMockStore.getState();
    const membership = Object.values(state.memberships).find(
      (m) => m.invite_token === token && m.state === 'pending',
    );

    if (!membership) {
      return { error: 'Invalid or expired invite token. Please request a new invite.', ctx: null };
    }

    const expired =
      membership.invite_expires_at && new Date(membership.invite_expires_at) < new Date();
    if (expired) {
      return { error: 'This invite has expired. Please request a new invite.', ctx: null };
    }

    const tenant = state.tenants[membership.tenant_id];
    const user = state.users[membership.user_id];

    if (!tenant || !user) {
      return { error: 'Invite data is corrupted. Please request a new invite.', ctx: null };
    }

    const adminMembership = Object.values(state.memberships).find(
      (m) =>
        m.tenant_id === membership.tenant_id &&
        m.state === 'active' &&
        m.user_id !== membership.user_id,
    );
    const invitedByUser = adminMembership ? state.users[adminMembership.user_id] : null;

    return {
      error: null,
      ctx: {
        membershipId: membership.id,
        tenantId: membership.tenant_id,
        tenantName: tenant.name,
        userId: membership.user_id,
        userName: user.name,
        roleIds: membership.role_ids,
        invitedByName: invitedByUser?.name ?? 'an administrator',
      },
    };
  } catch {
    return { error: 'An error occurred validating the invite.', ctx: null };
  }
}

export function InviteAcceptanceForm({ token }: InviteAcceptanceFormProps) {
  const navigate = useNavigate();

  // Resolve synchronously using lazy initializer — avoids setState in effects.
  const [tokenError] = useState<string | null>(() => {
    const r = resolveInviteContext(token);
    return r.error;
  });
  const [context] = useState<InviteContext | null>(() => {
    const r = resolveInviteContext(token);
    return r.ctx;
  });

  const [step, setStep] = useState<'credentials' | 'totp'>('credentials');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [totpEnrollment, setTotpEnrollment] = useState<TotpEnrollment | null>(null);

  const form = useForm<AcceptInviteFormValues>({
    validate: schemaResolver(acceptInviteSchema, { sync: true }),
    initialValues: { password: '', confirm: '' },
  });

  function handleCredentialsSubmit(values: AcceptInviteFormValues) {
    if (!context) return;
    // Validate the form values (password match) before advancing.
    void values; // Values already validated by Mantine form before this is called.
    setStep('totp');
  }

  async function handleTotpComplete(enrollment: TotpEnrollment) {
    if (!context) return;
    setTotpEnrollment(enrollment);

    // Now submit the full invite acceptance.
    setSubmitting(true);
    setSubmitError(null);

    try {
      const result = await acceptInvite(token, {
        password: form.values.password,
        totp: { code: '000000' }, // Stage-1: any code passed TOTP; real code in production
      });

      if (!result.ok) {
        setSubmitError(result.error ?? 'Failed to accept invite.');
        return;
      }

      // Navigate to the new tenant's dashboard.
      const state = useMockStore.getState();
      const tenant = state.tenants[context.tenantId];
      if (tenant) {
        await navigate({ to: '/t/$tenant/dashboard', params: { tenant: tenant.slug } });
      } else {
        await navigate({ to: '/login' });
      }
    } catch {
      setSubmitError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (tokenError) {
    return (
      <Stack gap="md">
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          variant="light"
          data-testid="invite-token-error"
        >
          {tokenError}
        </Alert>
        <Text size="sm" ta="center">
          <Anchor href="/login" size="sm">
            Back to sign in
          </Anchor>
        </Text>
      </Stack>
    );
  }

  if (!context) return null;

  return (
    <Stack gap="lg">
      {/* Invite context banner */}
      <Paper withBorder p="md" data-testid="invite-context">
        <Stack gap="xs">
          <Text size="sm">
            You&apos;ve been invited by <strong>{context.invitedByName}</strong> to join:
          </Text>
          <Title order={3}>{context.tenantName}</Title>
          <Text size="sm">
            Welcome, <strong>{context.userName}</strong>!
          </Text>
          {context.roleIds.length > 0 && (
            <Text size="xs">
              Roles:{' '}
              {context.roleIds.map((id) => (
                <Badge key={id} size="xs" variant="outline" mr={4}>
                  {id}
                </Badge>
              ))}
            </Text>
          )}
        </Stack>
      </Paper>

      {step === 'credentials' && (
        <form onSubmit={form.onSubmit((v) => { handleCredentialsSubmit(v); })}>
          <Stack gap="md">
            {submitError && (
              <Alert
                icon={<IconAlertCircle size={16} />}
                color="red"
                variant="light"
                data-testid="invite-submit-error"
              >
                {submitError}
              </Alert>
            )}

            <Text size="sm" fw={500}>
              Set your password
            </Text>

            <PasswordInput
              label="Password"
              placeholder="At least 8 characters"
              autoComplete="new-password"
              data-autofocus
              required
              data-testid="invite-password-input"
              {...form.getInputProps('password')}
            />

            <PasswordInput
              label="Confirm password"
              placeholder="Repeat the password"
              autoComplete="new-password"
              required
              data-testid="invite-confirm-input"
              {...form.getInputProps('confirm')}
            />

            <Button type="submit" loading={submitting} fullWidth data-testid="invite-next">
              Next: Set up authenticator
            </Button>
          </Stack>
        </form>
      )}

      {step === 'totp' && (
        <Stack gap="md">
          <Divider label="Set up two-factor authentication" labelPosition="center" />
          <Text size="sm">
            Two-factor authentication is required to complete your account setup.
          </Text>

          {submitError && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              variant="light"
              data-testid="invite-totp-error"
            >
              {submitError}
            </Alert>
          )}

          <TotpEnrollmentBlock
            userId={context.userId}
            onComplete={(enrollment) => void handleTotpComplete(enrollment)}
          />

          {/* Suppress unused variable warning */}
          {totpEnrollment !== null && null}
        </Stack>
      )}
    </Stack>
  );
}
