import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Container, Title, Card, Group, Text, Button, Badge } from '@mantine/core';
import { modals } from '@mantine/modals';
import { detectTenantMode, useActiveTenantSlug } from '@/hooks/use-tenant';
import { useMockStore } from '@/api/mock-store';

// TODO(stage-2): subdomain routing may change this flow — tenant picker may be
// replaced by per-subdomain auth with only a nav-menu switcher for changing tenants.

function TenantPicker() {
  const navigate = useNavigate();
  const mode = detectTenantMode();
  const currentSlug = useActiveTenantSlug();

  const tenants = useMockStore((s) => s.tenants);
  const currentUserId = useMockStore((s) => s.currentUserId);
  const memberships = useMockStore((s) => s.memberships);

  // Build tenant list scoped to the authenticated user's active memberships.
  const userTenantIds = Object.values(memberships)
    .filter((m) => m.user_id === currentUserId && m.state === 'active')
    .map((m) => m.tenant_id);

  const tenantList = Object.values(tenants)
    .filter((t) => userTenantIds.includes(t.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Auto-advance: if the user belongs to exactly one tenant, skip the picker.
  useEffect(() => {
    if (tenantList.length === 1 && tenantList[0]) {
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: tenantList[0].slug } });
    }
  }, [tenantList, navigate]);

  function handleSelect(slug: string) {
    if (mode === 'subdomain') {
      modals.openConfirmModal({
        title: 'Switch tenant',
        children: (
          <Text size="sm">
            Switching to <strong>{slug}</strong> will sign you out of{' '}
            <strong>{currentSlug ?? 'current tenant'}</strong>. Continue?
          </Text>
        ),
        labels: { confirm: 'Continue', cancel: 'Cancel' },
        onConfirm: () => {
          void navigate({ to: '/t/$tenant/dashboard', params: { tenant: slug } });
        },
      });
    } else {
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: slug } });
    }
  }

  // While auto-advancing for a single tenant, render nothing.
  if (tenantList.length === 1) {
    return null;
  }

  return (
    <Container py="xl">
      <Title order={1}>Tenants</Title>
      <Text mb="xl" mt="xs" size="sm">
        Select a tenant to continue.
      </Text>
      {tenantList.map((tenant) => (
        <Card key={tenant.id} withBorder mb="sm" padding="md">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <Text fw={600} size="sm">
                {tenant.name}
              </Text>
              <Badge variant="light" color="green">
                {tenant.slug}
              </Badge>
              {mode === 'subdomain' && (
                <Text size="xs" c="dimmed">
                  You&apos;ll need to sign in again
                </Text>
              )}
            </Group>
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                handleSelect(tenant.slug);
              }}
            >
              Open
            </Button>
          </Group>
        </Card>
      ))}
    </Container>
  );
}

export const Route = createFileRoute('/tenants')({
  beforeLoad: () => {
    const { currentUserId } = useMockStore.getState();
    if (currentUserId === null) {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw redirect({ to: '/login', search: { return: '/tenants' } });
    }
  },
  component: TenantPicker,
});
