import type { ReactNode } from 'react';
import { Center, Paper } from '@mantine/core';

export function UnauthLayout({ children }: { children: ReactNode }) {
  return (
    <Center mih="100vh">
      <Paper shadow="md" p="xl" w={400} maw="90vw">
        {children}
      </Paper>
    </Center>
  );
}
