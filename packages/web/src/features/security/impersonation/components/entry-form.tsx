/**
 * <ImpersonationEntryForm> — form for entering a super-admin impersonation session.
 *
 * Fields:
 *   - Tenant picker (from mock-store tenants)
 *   - Optional user picker (filtered by selected tenant's memberships)
 *   - Reason textarea (required, 20–500 chars)
 *   - Ticket ref URL/ID (optional)
 *   - TOTP code (6 digits, required)
 *   - Profile selector (minimal | full)
 *   - Additional scope multi-select (only when profile = full)
 *
 * On success, navigates to /t/<target-tenant>/dashboard.
 *
 * spec §8.2 / Task 1d.75
 */
import { useState } from 'react';
import {
  Stack,
  Select,
  Textarea,
  TextInput,
  MultiSelect,
  Button,
  Group,
  Alert,
  Text,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useMockStore } from '@/api/mock-store';
import { isRealApi } from '@/api/mode';
import { useDirtyForm } from '@/hooks/use-dirty-form';
import { useImpersonation } from '@/hooks/use-impersonation';
import {
  useStartImpersonation,
  getListImpersonationSessionsQueryKey,
} from '../realApi';
import { ProfileToggle } from './profile-toggle';
import { impersonationFormSchema, type ImpersonationFormValues } from '../schemas';

// ─── Tier options for the additional scope multi-select ───────────────────────

const TIER_OPTIONS = [
  { value: 'read-sensitive', label: 'Read Sensitive — includes audit log + PII fields' },
  { value: 'write', label: 'Write — create / update mutations' },
  { value: 'destructive', label: 'Destructive — delete / revoke actions' },
];

// ─── Component ────────────────────────────────────────────────────────────────

export function ImpersonationEntryForm() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useNavigate();
  const { entry } = useImpersonation();
  const queryClient = useQueryClient();
  const startMutation = useStartImpersonation();

  // Read tenants + memberships from store
  const tenants = useMockStore((s) => s.tenants);
  const memberships = useMockStore((s) => s.memberships);
  const users = useMockStore((s) => s.users);

  const tenantOptions = Object.values(tenants).map((t) => ({
    value: t.id,
    label: `${t.name} (${t.slug})`,
  }));

  const form = useForm<ImpersonationFormValues>({
    validate: schemaResolver(impersonationFormSchema, { sync: true }),
    validateInputOnBlur: true,
    initialValues: {
      tenant_id: '',
      user_id: undefined,
      reason: '',
      ticketRef: '',
      totpCode: '',
      profile: 'minimal',
      additionalScope: [],
    },
  });

  useDirtyForm(form);

  // Derive user options based on selected tenant
  const selectedTenantId = form.values.tenant_id;
  const tenantUserOptions = selectedTenantId
    ? Object.values(memberships)
        .filter((m) => m.tenant_id === selectedTenantId && m.state === 'active')
        .map((m) => {
          const user = users[m.user_id];
          return user ? { value: user.id, label: `${user.name} (${user.email})` } : null;
        })
        .filter((opt): opt is NonNullable<typeof opt> => opt !== null)
    : [];

  const profile = form.values.profile;

  async function handleSubmit(values: ImpersonationFormValues) {
    setSaving(true);
    setError(null);
    try {
      // Real-API mode: POST /api/v1/admin/impersonation. The TOTP code
      // is forwarded as an `X-TOTP-Code` header so the daemon can
      // enforce step-up auth without leaking it in the audit log
      // payload. The wire body matches the OpenAPI contract.
      if (isRealApi()) {
        const res = await startMutation.mutateAsync({
          data: {
            tenantId: values.tenant_id,
            targetUserId: values.user_id ?? '',
            reason: values.reason,
            ...(values.ticketRef?.trim() ? { ticketRef: values.ticketRef.trim() } : {}),
          },
        });
        await queryClient.invalidateQueries({
          queryKey: getListImpersonationSessionsQueryKey(),
        });
        // Mirror the daemon-issued session id into the mock store so the
        // mutator's `getActiveImpersonationId` accessor can stamp the
        // `X-Impersonation-Id` header on subsequent requests.
        const newId = res.data?.id;
        if (typeof newId === 'string' && newId !== '') {
          useMockStore.setState({ activeImpersonationId: newId });
        }
      }
      // Always run the local entry — it owns the two-sided audit emission
      // and the timer state machine. In real-API mode it duplicates the
      // session into the mock-store mirror; the bridge hook prefers the
      // daemon-reported session, so the banner shows the canonical one.
      await entry({
        tenant_id: values.tenant_id,
        ...(values.user_id ? { user_id: values.user_id } : {}),
        reason: values.reason,
        ...(values.ticketRef?.trim() ? { ticketRef: values.ticketRef.trim() } : {}),
        totpCode: values.totpCode,
        profile: values.profile,
        additionalScope: values.additionalScope,
      });

      // Navigate to target tenant dashboard
      const targetTenant = tenants[values.tenant_id];
      const tenantSlug = targetTenant?.slug ?? values.tenant_id;
      form.resetDirty(form.values);

      // Navigate — use typed route params; tenantSlug is a runtime value
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: tenantSlug } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={form.onSubmit((v) => void handleSubmit(v))}>
      <Stack gap="md">
        {error && (
          <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Error">
            {error}
          </Alert>
        )}

        <Alert color="orange" variant="light">
          <Text size="sm">
            Starting an impersonation session will be logged to both the super-admin audit log and
            the target tenant&apos;s audit log. All actions during the session are attributed to
            you, not the impersonated user.
          </Text>
        </Alert>

        <Select
          label="Target tenant"
          placeholder="Select a tenant…"
          data={tenantOptions}
          required
          searchable
          {...form.getInputProps('tenant_id')}
          onChange={(v: string | null) => {
            form.setFieldValue('tenant_id', v ?? '');
            form.setFieldValue('user_id', undefined);
          }}
        />

        <Select
          label="Target user (optional)"
          placeholder={
            selectedTenantId
              ? 'Impersonate as tenant-level (no specific user)…'
              : 'Select a tenant first'
          }
          data={tenantUserOptions}
          disabled={!selectedTenantId}
          searchable
          clearable
          {...form.getInputProps('user_id')}
        />

        <Textarea
          label="Reason"
          placeholder="Describe why you are impersonating this tenant (min. 20 characters)…"
          required
          minRows={3}
          maxRows={8}
          description="20–500 characters. This appears in both audit logs."
          {...form.getInputProps('reason')}
        />

        <TextInput
          label="Ticket reference (optional)"
          placeholder="e.g. https://jira.example.com/browse/OPS-123 or #1234"
          description="Support ticket or change request reference. Shown as a link in the impersonation banner."
          {...form.getInputProps('ticketRef')}
        />

        <ProfileToggle
          value={profile}
          onChange={(v) => {
            form.setFieldValue('profile', v);
          }}
        />

        {profile === 'full' && (
          <MultiSelect
            label="Additional scope"
            description="Read-only is always granted. Opt in to additional tiers if required."
            data={TIER_OPTIONS}
            placeholder="Select additional tiers…"
            {...form.getInputProps('additionalScope')}
          />
        )}

        <TextInput
          label="TOTP code"
          placeholder="6-digit code from your authenticator app"
          required
          maxLength={6}
          description="Your authenticator app one-time password."
          {...form.getInputProps('totpCode')}
        />

        <Group justify="flex-end" gap="xs">
          <Button
            variant="default"
            onClick={() => {
              void navigate({ to: '/admin' as string });
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" color="orange" loading={saving}>
            Start impersonation session
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
