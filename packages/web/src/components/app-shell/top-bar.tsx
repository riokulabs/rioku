import { Group, Title, TextInput, ActionIcon, Kbd, Flex, Box } from '@mantine/core';
import { IconSearch, IconBell } from '@tabler/icons-react';
import { spotlight } from '@mantine/spotlight';

export function TopBar() {
  return (
    <Flex h={56} px="md" align="center" gap="md">
      <Group gap="xs">
        <Box c="green" fw={700} style={{ fontSize: 20 }}>
          ◆
        </Box>
        <Title order={4}>Rioku</Title>
      </Group>
      <Box flex={1} />
      <TextInput
        placeholder="Search or jump to…"
        leftSection={<IconSearch size={16} />}
        rightSection={<Kbd>⌘K</Kbd>}
        rightSectionWidth={60}
        style={{ minWidth: 320 }}
        readOnly
        onClick={() => {
          spotlight.open();
        }}
      />
      <Box flex={1} />
      <ActionIcon size="lg" variant="subtle" aria-label="Notifications">
        <IconBell size={18} />
      </ActionIcon>
    </Flex>
  );
}
