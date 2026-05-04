/**
 * <GridCanvas> — drag-drop widget grid for the dashboard builder.
 *
 * 12-column CSS grid. Each widget's placement comes from
 * `dashboard.layout[widgetId]` (x/y/w/h). Drag a palette item → onto the
 * canvas and the parent creates a new widget at the drop coordinates. Drag
 * an existing widget → updates its layout entry. Resize handle on each
 * widget cell adjusts w/h in single-column/row increments.
 *
 * We use `@dnd-kit/core` for the DndContext + sensors + drop targets, and
 * `@dnd-kit/sortable` for the sortable widget list; but because the grid
 * is positional (not reorder-by-index), we mostly use the rectIntersection
 * collision detector + manual layout math. Sortable is kept around because
 * it exposes a clean dragging/transform API per cell.
 *
 * Interactions:
 *   - Drag existing widget → computes target (col,row) → onLayoutChange
 *   - Drag palette item (id starts with `palette-`) → onAddWidget(kind, x, y)
 *   - Click gear icon on cell → onSelect(widget.id)
 *   - Click trash icon on cell → onRemove(widget.id)
 *   - Drag resize handle → onResize(widget.id, w, h)
 */
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  PointerSensor,
  rectIntersection,
  useDroppable,
  useDraggable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { ActionIcon, Card, Group, Stack, Text, Tooltip } from '@mantine/core';
import { IconGripVertical, IconSettings, IconTrash } from '@tabler/icons-react';
import { WidgetRenderer } from '@/components/widget-renderer';
import { useWidgetData } from '../api';
import type { Dashboard, Widget } from '@/api/resources/types';

// ─── Constants ────────────────────────────────────────────────────────────────

const GRID_COLUMNS = 12;
const ROW_HEIGHT_PX = 80;
const MIN_W = 1;
const MIN_H = 1;
const MAX_W = 12;
const MAX_H = 16;

// ─── Props ────────────────────────────────────────────────────────────────────

export interface GridCanvasProps {
  dashboard: Dashboard;
  widgets: Widget[];
  selectedWidgetId: string | null;
  onSelect: (widgetId: string | null) => void;
  /** Called when a palette item is dropped onto the canvas. */
  onAddWidget: (kind: string, position: { x: number; y: number }) => void;
  /** Called when a widget is moved to a new grid position. */
  onMoveWidget: (widgetId: string, x: number, y: number) => void;
  /** Called when a widget is resized. */
  onResizeWidget: (widgetId: string, w: number, h: number) => void;
  /** Called when a widget's trash icon is clicked. */
  onRemoveWidget: (widgetId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampPosition(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  const cw = Math.max(MIN_W, Math.min(MAX_W, w));
  const ch = Math.max(MIN_H, Math.min(MAX_H, h));
  const cx = Math.max(0, Math.min(GRID_COLUMNS - cw, x));
  const cy = Math.max(0, y);
  return { x: cx, y: cy, w: cw, h: ch };
}

function pixelToGrid(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { col: number; row: number } {
  const relX = clientX - rect.left;
  const relY = clientY - rect.top;
  const colWidth = rect.width / GRID_COLUMNS;
  const col = Math.max(0, Math.min(GRID_COLUMNS - 1, Math.floor(relX / colWidth)));
  const row = Math.max(0, Math.floor(relY / ROW_HEIGHT_PX));
  return { col, row };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GridCanvas({
  dashboard,
  widgets,
  selectedWidgetId,
  onSelect,
  onAddWidget,
  onMoveWidget,
  onResizeWidget,
  onRemoveWidget,
}: GridCanvasProps) {
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [dragKind, setDragKind] = useState<'widget' | 'palette' | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setDragKind(id.startsWith('palette-') ? 'palette' : 'widget');
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, delta, activatorEvent } = event;
      setDragKind(null);
      const id = String(active.id);

      if (id.startsWith('palette-')) {
        const kind = id.slice('palette-'.length);
        const rect = gridRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Use activator + delta to locate the drop point; fall back to 0,0.
        const evt = activatorEvent as PointerEvent | undefined;
        const px = (evt?.clientX ?? rect.left) + delta.x;
        const py = (evt?.clientY ?? rect.top) + delta.y;
        if (px < rect.left || px > rect.right || py < rect.top || py > rect.bottom) {
          return;
        }
        const { col, row } = pixelToGrid(px, py, rect);
        onAddWidget(kind, { x: col, y: row });
        return;
      }

      if (delta.x === 0 && delta.y === 0) return;
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return;
      const colWidth = rect.width / GRID_COLUMNS;
      const colDelta = Math.round(delta.x / colWidth);
      const rowDelta = Math.round(delta.y / ROW_HEIGHT_PX);
      if (colDelta === 0 && rowDelta === 0) return;

      const layout = dashboard.layout[id];
      if (!layout) return;
      const clamped = clampPosition(layout.x + colDelta, layout.y + rowDelta, layout.w, layout.h);
      if (clamped.x !== layout.x || clamped.y !== layout.y) {
        onMoveWidget(id, clamped.x, clamped.y);
      }
    },
    [dashboard.layout, onAddWidget, onMoveWidget],
  );

  // Compute lowest free row for an empty-state visual hint.
  const emptyRow = useMemo(() => {
    if (widgets.length === 0) return 0;
    return Object.values(dashboard.layout).reduce((m, p) => (p.y + p.h > m ? p.y + p.h : m), 0);
  }, [widgets.length, dashboard.layout]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <CanvasDroppable gridRef={gridRef} dragKind={dragKind}>
        {widgets.length === 0 ? (
          <div
            data-testid="grid-empty"
            style={{
              gridColumn: '1 / -1',
              gridRow: '1 / span 4',
              minHeight: `${String(ROW_HEIGHT_PX * 4)}px`,
              border: '2px dashed var(--mantine-color-gray-4)',
              borderRadius: 'var(--mantine-radius-md)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 'var(--mantine-spacing-md)',
              textAlign: 'center',
            }}
          >
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Drag a widget type from the left onto this canvas to get started.
            </Text>
          </div>
        ) : (
          widgets.map((widget) => {
            const pos = dashboard.layout[widget.id] ?? widget.position;
            return (
              <GridCell
                key={widget.id}
                widget={widget}
                position={pos}
                selected={selectedWidgetId === widget.id}
                onSelect={() => {
                  onSelect(widget.id);
                }}
                onRemove={() => {
                  onRemoveWidget(widget.id);
                }}
                onResize={(w, h) => {
                  onResizeWidget(widget.id, w, h);
                }}
                gridRef={gridRef}
              />
            );
          })
        )}
        {/* Visual drop hint when a palette item is being dragged over a non-empty grid. */}
        {dragKind === 'palette' && widgets.length > 0 && (
          <div
            aria-hidden="true"
            style={{
              gridColumn: '1 / -1',
              gridRow: `${String(emptyRow + 1)} / span 2`,
              border: '2px dashed var(--mantine-color-blue-4)',
              borderRadius: 'var(--mantine-radius-md)',
              minHeight: `${String(ROW_HEIGHT_PX * 2)}px`,
              pointerEvents: 'none',
            }}
          />
        )}
      </CanvasDroppable>
    </DndContext>
  );
}

// ─── Droppable wrapper ────────────────────────────────────────────────────────

interface CanvasDroppableProps {
  gridRef: React.RefObject<HTMLDivElement | null>;
  dragKind: 'widget' | 'palette' | null;
  children: React.ReactNode;
}

function CanvasDroppable({ gridRef, dragKind, children }: CanvasDroppableProps) {
  const { setNodeRef, isOver } = useDroppable({ id: 'dashboard-grid' });

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      gridRef.current = node;
      setNodeRef(node);
    },
    [gridRef, setNodeRef],
  );

  return (
    <div
      ref={setRefs}
      data-testid="grid-canvas"
      role="list"
      aria-label="Dashboard grid canvas"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${String(GRID_COLUMNS)}, 1fr)`,
        gridAutoRows: `${String(ROW_HEIGHT_PX)}px`,
        gap: 'var(--mantine-spacing-md)',
        padding: 'var(--mantine-spacing-md)',
        minHeight: '100%',
        outline:
          isOver && dragKind === 'palette'
            ? '2px solid var(--mantine-color-blue-5)'
            : '1px solid var(--mantine-color-gray-3)',
        outlineOffset: isOver && dragKind === 'palette' ? '-2px' : '-1px',
        borderRadius: 'var(--mantine-radius-md)',
        background: 'var(--mantine-color-body)',
      }}
    >
      {children}
    </div>
  );
}

// ─── Cell ─────────────────────────────────────────────────────────────────────

interface GridCellProps {
  widget: Widget;
  position: { x: number; y: number; w: number; h: number };
  selected: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onResize: (w: number, h: number) => void;
  gridRef: React.RefObject<HTMLDivElement | null>;
}

function GridCell({
  widget,
  position,
  selected,
  onSelect,
  onRemove,
  onResize,
  gridRef,
}: GridCellProps) {
  const { data, loading, error } = useWidgetData(widget);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: widget.id,
  });

  const col = Math.max(0, Math.min(GRID_COLUMNS - 1, position.x));
  const row = Math.max(0, position.y);
  const span = Math.max(1, Math.min(GRID_COLUMNS - col, position.w));
  const rowSpan = Math.max(1, position.h);

  const cellStyle: CSSProperties = {
    gridColumn: `${String(col + 1)} / span ${String(span)}`,
    gridRow: `${String(row + 1)} / span ${String(rowSpan)}`,
    overflow: 'hidden',
    minWidth: 0,
    position: 'relative',
    ...(transform
      ? {
          transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)`,
        }
      : {}),
    opacity: isDragging ? 0.6 : 1,
    zIndex: isDragging ? 10 : 1,
    outline: selected ? '2px solid var(--mantine-color-blue-5)' : '1px solid transparent',
    outlineOffset: '-2px',
    borderRadius: 'var(--mantine-radius-md)',
  };

  const rendererProps = {
    widget,
    data,
    loading,
    ...(error !== undefined ? { error } : {}),
  };

  // Resize pointer drag — computes delta against the grid's column width and
  // row-height, then snaps to 1-unit increments.
  const handleResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const gridRect = gridRef.current?.getBoundingClientRect();
    if (!gridRect) return;
    const colWidth = gridRect.width / GRID_COLUMNS;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = position.w;
    const startH = position.h;
    let lastW = startW;
    let lastH = startH;

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const nextW = Math.max(MIN_W, Math.min(MAX_W, startW + Math.round(dx / colWidth)));
      const nextH = Math.max(MIN_H, Math.min(MAX_H, startH + Math.round(dy / ROW_HEIGHT_PX)));
      if (nextW !== lastW || nextH !== lastH) {
        lastW = nextW;
        lastH = nextH;
        onResize(nextW, nextH);
      }
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div
      ref={setNodeRef}
      role="listitem"
      aria-label={widget.title}
      {...(selected ? { 'aria-current': 'true' } : {})}
      style={cellStyle}
      data-testid={`widget-cell-${widget.id}`}
    >
      <Card withBorder radius="md" p="sm" h="100%">
        <Stack gap="xs" h="100%">
          <Group justify="space-between" wrap="nowrap">
            <Group gap={4} wrap="nowrap" style={{ minWidth: 0 }}>
              <Tooltip label="Drag to reposition" withArrow>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={`Drag handle for ${widget.title}`}
                  {...attributes}
                  {...listeners}
                  style={{ cursor: 'grab' }}
                >
                  <IconGripVertical size={14} />
                </ActionIcon>
              </Tooltip>
              <Text size="sm" fw={600} truncate>
                {widget.title}
              </Text>
            </Group>
            <Group gap={2} wrap="nowrap">
              <Tooltip label="Configure" withArrow>
                <ActionIcon
                  variant="subtle"
                  size="sm"
                  aria-label={`Configure ${widget.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect();
                  }}
                >
                  <IconSettings size={14} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label="Remove" withArrow>
                <ActionIcon
                  variant="subtle"
                  color="red.8"
                  size="sm"
                  aria-label={`Remove ${widget.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                >
                  <IconTrash size={14} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </Group>

          <div style={{ flex: 1, minHeight: 0 }}>
            <WidgetRenderer {...rendererProps} />
          </div>
        </Stack>
      </Card>

      {/* Resize handle */}
      <div
        role="separator"
        aria-label={`Resize ${widget.title}`}
        aria-valuemin={1}
        aria-valuemax={12}
        aria-valuenow={position.w}
        data-testid={`widget-resize-${widget.id}`}
        onPointerDown={handleResizePointerDown}
        style={{
          position: 'absolute',
          bottom: 2,
          right: 2,
          width: 14,
          height: 14,
          cursor: 'nwse-resize',
          background: 'linear-gradient(135deg, transparent 50%, var(--mantine-color-gray-5) 50%)',
          borderBottomRightRadius: 4,
        }}
      />
    </div>
  );
}
