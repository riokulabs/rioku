import { Center, Stack, ThemeIcon, Title, Text, Button } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { IdBadge } from '@/components/id-badge';

export interface ErrorStateProps {
  /** Headline. Defaults to "Something went wrong". */
  title?: string;
  /** Human-readable error detail. */
  description?: string;
  /**
   * Opaque server correlation ID for support tickets. When present, rendered
   * as a click-to-copy <IdBadge>.
   */
  correlationId?: string;
  /** Optional retry callback. Renders a "Try again" button when provided. */
  retry?: () => void;
}

/**
 * ErrorState renders a prominent error placeholder for failed data loads or
 * unexpected errors.  Use it in place of a page/section when the data cannot
 * be displayed.  For zero-result data, use <EmptyState> instead.
 */
export function ErrorState({
  title = 'Something went wrong',
  description,
  correlationId,
  retry,
}: ErrorStateProps) {
  return (
    <Center py="xl">
      <Stack align="center" gap="sm" maw={400} ta="center">
        <ThemeIcon size={64} radius="xl" variant="light" color="red">
          <IconAlertCircle size={32} />
        </ThemeIcon>
        <Title order={4}>{title}</Title>
        {description && (
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {description}
          </Text>
        )}
        {correlationId && (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Correlation ID: <IdBadge id={correlationId} />
          </Text>
        )}
        {retry && (
          <Button variant="light" color="red.8" onClick={retry} mt="xs">
            Try again
          </Button>
        )}
      </Stack>
    </Center>
  );
}
