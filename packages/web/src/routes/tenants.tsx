import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Container, Title, Card, Group, Text, Button, Badge } from '@mantine/core';
import { modals } from '@mantine/modals';
import { detectTenantMode, useActiveTenantSlug } from '@/hooks/use-tenant';
import { useMockStore } from '@/api/mock-store';

function TenantPicker() {
  const navigate = useNavigate();
  const mode = detectTenantMode();
  const currentSlug = useActiveTenantSlug();

  const tenants = useMockStore((s) => s.tenants);
  const tenantList = Object.values(tenants).sort((a, b) => a.name.localeCompare(b.name));

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
  component: TenantPicker,
});
