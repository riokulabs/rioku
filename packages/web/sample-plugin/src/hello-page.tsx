import { Stack, Text, Title } from '@mantine/core';

/**
 * Route component rendered at `/plugins/hello`.
 * Kept deliberately minimal — the stable selector is the `data-testid`.
 */
export function HelloPage() {
  return (
    <Stack gap="sm" data-testid="sample-plugin-hello">
      <Title order={3}>Hello from the sample plugin</Title>
      <Text>
        This page proves the sample plugin&apos;s route + component render path works end-to-end.
      </Text>
    </Stack>
  );
}
