import { useState } from 'react';
import { Modal, Table, Kbd, Group, Text } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { spotlight } from '@mantine/spotlight';

interface ShortcutRow {
  keys: string[];
  description: string;
}

const SHORTCUTS: ShortcutRow[] = [
  { keys: ['⌘K', 'Ctrl+K'], description: 'Open spotlight' },
  { keys: ['/'], description: 'Open spotlight (when not in a text input)' },
  { keys: ['g', 'd'], description: 'Navigate to dashboard (placeholder)' },
  { keys: ['g', 's'], description: 'Navigate to services (placeholder)' },
  { keys: ['⌘S', 'Ctrl+S'], description: 'Save form' },
  { keys: ['Esc'], description: 'Dismiss modal' },
  { keys: ['?'], description: 'Show this help' },
];

export function KeyboardShortcutsHelp() {
  const [opened, setOpened] = useState(false);

  // `?` = shift+/ — Mantine useHotkeys ignores input/textarea/select by default
  useHotkeys([
    [
      '?',
      () => {
        setOpened((o) => !o);
      },
    ],
    [
      '/',
      (e) => {
        // Only trigger when focus is not already inside a text field
        const tag = (e.target as HTMLElement).tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        e.preventDefault();
        spotlight.open();
      },
    ],
  ]);

  const rows = SHORTCUTS.map((row, i) => (
    <Table.Tr key={i}>
      <Table.Td>
        <Group gap={4} wrap="nowrap">
          {row.keys.map((k, j) => (
            <Kbd key={j} size="sm">
              {k}
            </Kbd>
          ))}
        </Group>
      </Table.Td>
      <Table.Td>
        <Text size="sm">{row.description}</Text>
      </Table.Td>
    </Table.Tr>
  ));

  return (
    <Modal
      opened={opened}
      onClose={() => {
        setOpened(false);
      }}
      title="Keyboard shortcuts"
      size="md"
      transitionProps={{ duration: 0 }}
      closeButtonProps={{ 'aria-label': 'Close keyboard shortcuts' }}
    >
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Keys</Table.Th>
            <Table.Th>Action</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>{rows}</Table.Tbody>
      </Table>
    </Modal>
  );
}
