import { Center, Stack, ThemeIcon, Title, Text, Button } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';

export interface EmptyStateProps {
  icon: Icon;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * EmptyState renders a centered illustration-like placeholder when a list or
 * data surface has no content.  Use it inside a page section or table body —
 * not as a full-page error (use <ErrorState> for that).
 */
export function EmptyState({ icon: IconComponent, title, description, action }: EmptyStateProps) {
  return (
    <Center py="xl">
      <Stack align="center" gap="sm" maw={400} ta="center">
        <ThemeIcon size={64} radius="xl" variant="light">
          <IconComponent size={32} />
        </ThemeIcon>
        <Title order={4}>{title}</Title>
        {description && (
          <Text size="sm" c="dimmed">
            {description}
          </Text>
        )}
        {action && (
          <Button variant="light" onClick={action.onClick} mt="xs">
            {action.label}
          </Button>
        )}
      </Stack>
    </Center>
  );
}
