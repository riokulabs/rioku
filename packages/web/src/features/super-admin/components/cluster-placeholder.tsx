/**
 * <ClusterPlaceholder> — empty state for cluster management view.
 *
 * Real cluster management UI lands in stage 2+.
 * spec §8.1 / Task 1d.78
 */
import { IconServer } from '@tabler/icons-react';
import { Stack, Title } from '@mantine/core';
import { EmptyState } from '@/components/empty-state';

export function ClusterPlaceholder() {
  return (
    <Stack gap="md" p="md">
      <Title order={2}>Cluster</Title>
      <EmptyState
        icon={IconServer}
        title="Cluster management"
        description="Cluster topology, node health, and sync status will be populated in stage 2."
      />
    </Stack>
  );
}
