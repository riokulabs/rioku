/**
 * <MiddlewareStackEditor> — ordered list of middlewares attached to a route.
 *
 * The list supports reorder via up/down arrow buttons. Per plan directive we
 * do NOT install any drag-drop dependency — arrow buttons only. An "Add
 * middleware" Select lets the user pick from tenant middlewares not already
 * in the stack.
 */
import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Badge, Button, Group, Select, Stack, Table, Text } from '@mantine/core';
import {
  IconAlertCircle,
  IconArrowDown,
  IconArrowUp,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { reorderMiddlewares } from '../api';

interface MiddlewareStackEditorProps {
  routeId: string;
  tenantId: string;
}

const KIND_COLORS: Record<string, string> = {
  'rate-limit': 'cyan',
  auth: 'red',
  transform: 'violet',
  cors: 'orange',
  cache: 'green',
  logging: 'gray',
  custom: 'grape',
};

export function MiddlewareStackEditor({ routeId, tenantId }: MiddlewareStackEditorProps) {
  const routes = useMockStore((s) => s.routes);
  const middlewares = useMockStore((s) => s.middlewares);

  const route = routes[routeId];
  const stackIds = route?.middleware_ids ?? [];

  const stack = useMemo(
    () =>
      stackIds
        .map((id) => middlewares[id])
        .filter((m): m is NonNullable<typeof m> => m !== undefined),
    [stackIds, middlewares],
  );

  const candidates = useMemo(() => {
    const inStack = new Set(stackIds);
    return Object.values(middlewares).filter((m) => m.tenant_id === tenantId && !inStack.has(m.id));
  }, [middlewares, stackIds, tenantId]);

  const [picker, setPicker] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function applyOrder(nextOrder: string[]) {
    setBusy(true);
    try {
      await reorderMiddlewares(routeId, nextOrder);
    } catch {
      notify.error('Failed to reorder middlewares', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function moveUp(index: number) {
    if (index <= 0) return;
    const next = [...stackIds];
    const a = next[index - 1];
    const b = next[index];
    if (a === undefined || b === undefined) return;
    next[index - 1] = b;
    next[index] = a;
    await applyOrder(next);
  }

  async function moveDown(index: number) {
    if (index >= stackIds.length - 1) return;
    const next = [...stackIds];
    const a = next[index];
    const b = next[index + 1];
    if (a === undefined || b === undefined) return;
    next[index] = b;
    next[index + 1] = a;
    await applyOrder(next);
  }

  async function removeAt(index: number) {
    const next = stackIds.filter((_, i) => i !== index);
    await applyOrder(next);
  }

  async function addToStack() {
    if (picker === null) return;
    await applyOrder([...stackIds, picker]);
    setPicker(null);
  }

  if (!route) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={14} />}>
        Route not found.
      </Alert>
    );
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={600}>
        Middleware stack ({String(stack.length)})
      </Text>

      {stack.length === 0 ? (
        <Alert icon={<IconAlertCircle size={14} />} variant="light" color="gray" p="xs">
          <Text size="xs">No middlewares attached. Stack executes in list order.</Text>
        </Alert>
      ) : (
        <Table striped>
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 40 }}>#</Table.Th>
              <Table.Th>Name</Table.Th>
              <Table.Th>Kind</Table.Th>
              <Table.Th style={{ width: 140 }}>Reorder</Table.Th>
              <Table.Th style={{ width: 60 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {stack.map((m, i) => (
              <Table.Tr key={m.id}>
                <Table.Td>
                  <Text size="xs" ff="monospace">
                    {String(i + 1)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">{m.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" variant="light" color={KIND_COLORS[m.kind] ?? 'gray'}>
                    {m.kind}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Group gap={4}>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      disabled={i === 0 || busy}
                      aria-label={`Move ${m.name} up`}
                      onClick={() => void moveUp(i)}
                    >
                      <IconArrowUp size={14} />
                    </ActionIcon>
                    <ActionIcon
                      size="sm"
                      variant="subtle"
                      disabled={i === stack.length - 1 || busy}
                      aria-label={`Move ${m.name} down`}
                      onClick={() => void moveDown(i)}
                    >
                      <IconArrowDown size={14} />
                    </ActionIcon>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red.8"
                    disabled={busy}
                    aria-label={`Remove ${m.name} from stack`}
                    onClick={() => void removeAt(i)}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      {/* Add middleware picker */}
      <Group gap="sm" align="flex-end">
        <Select
          placeholder="Select middleware to add"
          data={candidates.map((m) => ({
            value: m.id,
            label: `${m.name} — ${m.kind}`,
          }))}
          value={picker}
          onChange={setPicker}
          searchable
          disabled={candidates.length === 0 || busy}
          style={{ flex: 1 }}
          aria-label="Select middleware to add to stack"
        />
        <Button
          leftSection={<IconPlus size={14} />}
          size="sm"
          disabled={picker === null || busy}
          onClick={() => void addToStack()}
        >
          Add
        </Button>
      </Group>
    </Stack>
  );
}
