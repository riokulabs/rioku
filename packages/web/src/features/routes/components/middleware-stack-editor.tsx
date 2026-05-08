/**
 * <MiddlewareStackEditor> — ordered list of middlewares attached to a route
 * with drag-and-drop reorder powered by `@dnd-kit/sortable`.
 *
 * The route's middleware IDs come from the real (Stage-2) route fetched
 * via `useRouteDetail(tenantId, routeId)`. After a sortable drop the
 * ordered list is PUT to the dedicated endpoint
 * `/api/v1/t/{tenant}/routes/{id}/middlewares/order`. The daemon updates
 * the `rioku.admin/middleware-ids` label and triggers a Caddy reload; the
 * route query is invalidated so the next render picks up the new order.
 *
 * Middleware display metadata (`name`, `kind`) is read from the real-API
 * `useMiddlewareList` selector. The UI gracefully degrades to "id only"
 * if the metadata is missing.
 */
import { useMemo, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ActionIcon, Alert, Badge, Button, Group, Select, Stack, Text } from '@mantine/core';
import { IconAlertCircle, IconGripVertical, IconPlus, IconTrash } from '@tabler/icons-react';
import { useMiddlewareList } from '@/features/middlewares';
import { notify } from '@/hooks/use-notify';
import { useRouteDetail, useReorderMiddlewaresMutation } from '../api';

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

interface StackRowProps {
  id: string;
  index: number;
  name: string;
  kind: string | undefined;
  onRemove: () => void;
  busy: boolean;
}

function SortableStackRow({ id, index, name, kind, onRemove, busy }: StackRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: 'grid',
    gridTemplateColumns: '24px 24px 1fr 100px 32px',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    border: '1px solid var(--mantine-color-gray-3)',
    borderRadius: 4,
    background: 'var(--mantine-color-body)',
  };
  return (
    <div ref={setNodeRef} style={style} data-testid={`stack-row-${id}`}>
      <ActionIcon
        size="sm"
        variant="subtle"
        aria-label={`Drag handle for ${name}`}
        {...attributes}
        {...listeners}
        style={{ cursor: 'grab' }}
      >
        <IconGripVertical size={14} />
      </ActionIcon>
      <Text size="xs" ff="monospace">
        {String(index + 1)}
      </Text>
      <Text size="xs">{name}</Text>
      <Badge size="xs" variant="light" color={KIND_COLORS[kind ?? 'custom'] ?? 'gray'}>
        {kind ?? 'unknown'}
      </Badge>
      <ActionIcon
        size="sm"
        variant="subtle"
        color="red.8"
        disabled={busy}
        aria-label={`Remove ${name} from stack`}
        onClick={onRemove}
      >
        <IconTrash size={14} />
      </ActionIcon>
    </div>
  );
}

export function MiddlewareStackEditor({ routeId, tenantId }: MiddlewareStackEditorProps) {
  const route = useRouteDetail(tenantId, routeId);
  const middlewares = useMiddlewareList(tenantId, { search: '', kind: 'all', enabled: 'all' });

  const stackIds = useMemo<string[]>(() => route?.middleware_ids ?? [], [route]);

  const middlewaresById = useMemo(() => {
    const map = new Map<string, { name: string; kind: string }>();
    for (const m of middlewares) {
      map.set(m.id, { name: m.name, kind: m.kind });
    }
    return map;
  }, [middlewares]);

  const candidates = useMemo(() => {
    const inStack = new Set(stackIds);
    return middlewares.filter((m) => !inStack.has(m.id));
  }, [middlewares, stackIds]);

  const [picker, setPicker] = useState<string | null>(null);
  const reorder = useReorderMiddlewaresMutation(tenantId);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  async function applyOrder(nextOrder: string[]) {
    try {
      await reorder.mutateAsync({ routeId, middlewareIds: nextOrder });
    } catch {
      notify.error('Failed to reorder middlewares', 'Please try again.');
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over === null || active.id === over.id) return;
    const oldIndex = stackIds.indexOf(String(active.id));
    const newIndex = stackIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove(stackIds, oldIndex, newIndex);
    void applyOrder(next);
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
    <Stack gap="xs" data-testid="middleware-stack-editor">
      <Text size="sm" fw={600}>
        Middleware stack ({String(stackIds.length)})
      </Text>

      {stackIds.length === 0 ? (
        <Alert icon={<IconAlertCircle size={14} />} variant="light" color="gray" p="xs">
          <Text size="xs">No middlewares attached. Stack executes in list order.</Text>
        </Alert>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={stackIds} strategy={verticalListSortingStrategy}>
            <Stack gap={4}>
              {stackIds.map((id, i) => {
                const meta = middlewaresById.get(id);
                return (
                  <SortableStackRow
                    key={id}
                    id={id}
                    index={i}
                    name={meta?.name ?? id}
                    kind={meta?.kind}
                    onRemove={() => void removeAt(i)}
                    busy={reorder.isPending}
                  />
                );
              })}
            </Stack>
          </SortableContext>
        </DndContext>
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
          disabled={candidates.length === 0 || reorder.isPending}
          style={{ flex: 1 }}
          aria-label="Select middleware to add to stack"
        />
        <Button
          leftSection={<IconPlus size={14} />}
          size="sm"
          disabled={picker === null || reorder.isPending}
          onClick={() => void addToStack()}
        >
          Add
        </Button>
      </Group>
    </Stack>
  );
}
