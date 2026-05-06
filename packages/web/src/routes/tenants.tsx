import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { Container, Title, Card, Group, Text, Button, Badge } from '@mantine/core';
import { modals } from '@mantine/modals';
import type { Tenant } from '@/api/resources/common';
import { useActiveTenantSlug } from '@/hooks/use-tenant';
import { useMockStore } from '@/api/mock-store';

/**
 * Build the URL to navigate to when selecting a tenant.
 *
 * - path mode tenant: stay on same origin, route to /t/:slug/dashboard
 * - subdomain mode tenant with parent_domain: navigate to
 *   http(s)://<slug>.<parent_domain>:<port>/t/<slug>/dashboard
 *   The browser will carry the session cookie (Domain=.<parent>) automatically.
 */
export function tenantDashboardUrl(tenant: Tenant): { href: string; isExternal: boolean } {
  const isSubdomain = tenant.url_mode === 'subdomain' && tenant.parent_domain;
  if (isSubdomain) {
    const proto = window.location.protocol;
    const port = window.location.port ? `:${window.location.port}` : '';
    const parent = tenant.parent_domain!.replace(/^\./, '');
    const href = `${proto}//${tenant.slug}.${parent}${port}/t/${tenant.slug}/dashboard`;
    return { href, isExternal: true };
  }
  return { href: `/t/${tenant.slug}/dashboard`, isExternal: false };
}

function TenantPicker() {
  const navigate = useNavigate();
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
    const only = tenantList.length === 1 ? tenantList[0] : null;
    if (only) {
      const { href, isExternal } = tenantDashboardUrl(only);
      if (isExternal) {
        window.location.href = href;
      } else {
        void navigate({ to: '/t/$tenant/dashboard', params: { tenant: only.slug } });
      }
    }
  }, [tenantList, navigate]);

  function handleSelect(tenant: Tenant) {
    const { href, isExternal } = tenantDashboardUrl(tenant);
    const isSubdomain = tenant.url_mode === 'subdomain';

    if (isSubdomain && isExternal) {
      // Switching to a subdomain-mode tenant: inform the user they may need
      // to re-authenticate if they don't already have a cookie scoped to
      // that parent domain.
      modals.openConfirmModal({
        title: 'Switch to subdomain tenant',
        children: (
          <Text size="sm">
            <strong>{tenant.name}</strong> runs on its own subdomain. You may need to sign in
            again if you don&apos;t have an active session on{' '}
            <strong>{tenant.parent_domain ?? tenant.slug}</strong>. Continue?
          </Text>
        ),
        labels: { confirm: 'Continue', cancel: 'Cancel' },
        onConfirm: () => {
          window.location.href = href;
        },
      });
    } else if (!isSubdomain && currentSlug !== null) {
      // Switching between path-mode tenants — no re-auth, just navigate.
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: tenant.slug } });
    } else {
      // Default: navigate to the tenant (external or internal).
      if (isExternal) {
        window.location.href = href;
      } else {
        void navigate({ to: '/t/$tenant/dashboard', params: { tenant: tenant.slug } });
      }
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
              {tenant.url_mode === 'subdomain' && (
                <Badge variant="outline" color="blue" size="xs">
                  subdomain
                </Badge>
              )}
              {tenant.url_mode === 'subdomain' && tenant.slug !== currentSlug && (
                <Text size="xs" c="dimmed">
                  May require sign-in
                </Text>
              )}
            </Group>
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                handleSelect(tenant);
              }}
              data-testid={`tenant-picker-open-${tenant.slug}`}
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
