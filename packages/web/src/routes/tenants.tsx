import { createFileRoute } from '@tanstack/react-router';
import { Title, Container } from '@mantine/core';

export const Route = createFileRoute('/tenants')({
  component: () => (
    <Container py="xl">
      <Title order={1}>Tenants</Title>
      <p>Tenant picker (populated in Plan 1d)</p>
    </Container>
  ),
});
