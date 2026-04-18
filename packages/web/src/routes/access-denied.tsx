import { createFileRoute, Link } from '@tanstack/react-router';
import { Container, Title, Text, Button } from '@mantine/core';

export const Route = createFileRoute('/access-denied')({
  component: () => (
    <Container py="xl">
      <Title order={2}>Access denied</Title>
      <Text c="dimmed" mt="md">
        You don&apos;t have permission to view this page. Contact your tenant administrator for access.
      </Text>
      <Button component={Link} to="/" mt="lg">
        Back to home
      </Button>
    </Container>
  ),
});
