import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import { Container, Title, Text, Button, Code, Group } from '@mantine/core';

export const Route = createFileRoute('/access-denied')({
  component: AccessDeniedPage,
});

// Search params passed by requirePermissions on redirect
interface AccessDeniedSearch {
  required?: string[];
  requireAny?: boolean;
}

function AccessDeniedPage() {
  // useSearch({ strict: false }) reads the raw search string without requiring
  // a validated schema on this route. This lets requirePermissions redirect here
  // with arbitrary search params without needing a Zod schema on /access-denied.
  const search = useSearch({ strict: false }) as unknown as AccessDeniedSearch;

  const required: string[] | undefined =
    Array.isArray(search.required) && search.required.length > 0 ? search.required : undefined;

  const requireAny: boolean = search.requireAny === true;

  return (
    <Container py="xl">
      <Title order={2}>Access denied</Title>
      <Text c="dimmed" mt="md">
        You don&apos;t have permission to view this page.
      </Text>

      {required && (
        <Text mt="md" size="sm">
          <strong>Required{requireAny ? ' (any one of)' : ' (all required)'}:</strong>{' '}
          <Group gap="xs" display="inline-flex">
            {required.map((key) => (
              <Code key={key}>{key}</Code>
            ))}
          </Group>
        </Text>
      )}

      <Button component={Link} to="/" mt="lg">
        Back to home
      </Button>
    </Container>
  );
}
