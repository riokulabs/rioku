import { MantineProvider, Title, Center } from '@mantine/core';

export function App() {
  return (
    <MantineProvider defaultColorScheme="dark">
      <Center h="100vh">
        <Title order={1}>Rioku — hello</Title>
      </Center>
    </MantineProvider>
  );
}
