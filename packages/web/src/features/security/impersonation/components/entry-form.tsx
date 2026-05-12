/**
 * <ImpersonationEntryForm> — form for entering a super-admin impersonation session.
 *
 * Fields:
 *   - Tenant ID (free-form; canonical tenant directory lands in plan-11
 *     super-admin and replaces this with a real Select)
 *   - Optional user picker (populated from the daemon `useListUsers`
 *     once a tenant id is entered)
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
import { setActiveImpersonationId } from '@/api/active-impersonation';
import { isRealApi } from '@/api/mode';
import { useListUsers } from '@/api/generated/users/users';
import { useListAdminTenants } from '@/api/generated/admin/admin';
import { useDirtyForm } from '@/hooks/use-dirty-form';
import { useImpersonation } from '@/hooks/use-impersonation';
import { useStartImpersonation, getListImpersonationSessionsQueryKey } from '../realApi';
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

  const selectedTenantId = form.values.tenant_id;

  // Stage-2: tenant directory now lives at /api/v1/admin/tenants. Drive
  // the Target-tenant Select off that list so super-admins pick from
  // real tenants rather than pasting an id by hand.
  const tenantsQuery = useListAdminTenants();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const tenantOptions = (tenantsQuery.data?.data?.items ?? [])
    .filter((t): t is { id: string; slug?: string; name?: string } => typeof t.id === 'string')
    .map((t) => ({
      value: t.slug ?? t.id,
      label: t.name ? `${t.name} (${t.slug ?? t.id})` : (t.slug ?? t.id),
    }));

  // Fetch users for the selected tenant from the daemon. Disabled until a
  // tenant id is entered; per-tenant scope mirrors the daemon's auth model.
  const usersQuery = useListUsers(selectedTenantId, {
    query: { enabled: selectedTenantId.trim() !== '' },
  });
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const tenantUsers = usersQuery.data?.data?.users ?? [];
  const tenantUserOptions = tenantUsers
    .filter((u): u is { id: string; name?: string; email?: string } => typeof u.id === 'string')
    .map((u) => ({
      value: u.id,
      label: u.name ? `${u.name} (${u.email ?? ''})` : (u.email ?? u.id),
    }));

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
        // Mirror the daemon-issued session id into the active-impersonation
        // holder so the mutator can stamp the `X-Impersonation-Id` header
        // on subsequent requests.
        const newId = res.data?.id;
        if (typeof newId === 'string' && newId !== '') {
          setActiveImpersonationId(newId);
        }
      }
      // Always run the local entry — it owns the two-sided audit emission
      // and the timer state machine. In real-API mode it duplicates the
      // session into the local mirror; the bridge hook prefers the
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

      form.resetDirty(form.values);

      // Navigate — tenant id is the route segment until the directory API
      // (plan-11) exposes a slug lookup we can resolve client-side.
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: values.tenant_id } });
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
          placeholder={
            tenantsQuery.isLoading ? 'Loading tenants…' : 'Pick the tenant to impersonate into…'
          }
          data={tenantOptions}
          required
          searchable
          disabled={tenantsQuery.isLoading}
          description="Tenants visible to your super-admin role. Switch from the directory at /admin/tenants if a tenant is missing here."
          {...form.getInputProps('tenant_id')}
          onChange={(value) => {
            form.setFieldValue('tenant_id', value ?? '');
            form.setFieldValue('user_id', undefined);
          }}
        />

        <Select
          label="Target user (optional)"
          placeholder={
            selectedTenantId.trim() === ''
              ? 'Enter a tenant id first'
              : 'Impersonate as tenant-level (no specific user)…'
          }
          data={tenantUserOptions}
          disabled={selectedTenantId.trim() === '' || usersQuery.isLoading}
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
