import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Container, Title, Card, Group, Text, Button, Badge } from '@mantine/core';
import { modals } from '@mantine/modals';
import { detectTenantMode, useActiveTenantSlug } from '@/hooks/use-tenant';

// Stage-1 stub: hardcoded tenants. Phase 1c seeds via mock-store.
const STUB_TENANTS = ['acme', 'beta', 'gamma'];

function TenantPicker() {
  const navigate = useNavigate();
  const mode = detectTenantMode();
  const currentSlug = useActiveTenantSlug();

  function handleSelect(tenant: string) {
    if (mode === 'subdomain') {
      modals.openConfirmModal({
        title: 'Switch tenant',
        children: (
          <Text size="sm">
            Switching to <strong>{tenant}</strong> will sign you out of{' '}
            <strong>{currentSlug ?? 'current tenant'}</strong>. Continue?
          </Text>
        ),
        labels: { confirm: 'Continue', cancel: 'Cancel' },
        onConfirm: () => {
          void navigate({ to: '/t/$tenant/dashboard', params: { tenant } });
        },
      });
    } else {
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant } });
    }
  }

  return (
    <Container py="xl">
      <Title order={1}>Tenants</Title>
      <Text mb="xl" mt="xs" size="sm">
        Select a tenant to continue.
      </Text>
      {STUB_TENANTS.map((tenant) => (
        <Card key={tenant} withBorder mb="sm" padding="md">
          <Group justify="space-between" align="center">
            <Group gap="sm">
              <Badge variant="light" color="green">
                {tenant}
              </Badge>
              {mode === 'subdomain' && (
                <Text size="xs" c="dimmed">
                  You&apos;ll need to sign in again
                </Text>
              )}
            </Group>
            <Button variant="default" size="sm" onClick={() => { handleSelect(tenant); }}>
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
