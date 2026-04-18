import { createFileRoute } from '@tanstack/react-router';
import { Center, Title } from '@mantine/core';

export const Route = createFileRoute('/')({
  component: IndexPage,
});

function IndexPage() {
  return (
    <Center h="100vh">
      <Title order={1}>Rioku — hello</Title>
    </Center>
  );
}
