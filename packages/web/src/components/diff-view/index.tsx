/**
 * <DiffView> — side-by-side JSON diff.
 *
 * Rolls its own recursive diff (no jsondiffpatch dep needed for stage-1
 * clarity). For each key in union(before, after):
 *   unchanged  → shown in both columns, muted color
 *   changed    → red in left (before) / green in right (after)
 *   added      → "—" left / green right
 *   removed    → red left / "—" right
 *
 * Nested objects are recursed one level at a time (indented tree).
 * Deeply nested primitives are JSON-stringified.
 *
 * compact=true hides unchanged keys.
 */
import { useMemo } from 'react';
import { Paper, Text, SimpleGrid, Box, Group, Stack, Badge } from '@mantine/core';

// ── Diff node types ───────────────────────────────────────────────────────────

type DiffStatus = 'unchanged' | 'changed' | 'added' | 'removed';

interface DiffNode {
  key: string;
  status: DiffStatus;
  /** Left value (before). undefined = key not present in before. */
  left: unknown;
  /** Right value (after). undefined = key not present in after. */
  right: unknown;
  /** Nested children when both sides are plain objects. */
  children?: DiffNode[];
  depth: number;
}

// ── Diff engine ───────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function diffObjects(before: unknown, after: unknown, depth = 0): DiffNode[] {
  const beforeObj: Record<string, unknown> = isPlainObject(before) ? before : {};
  const afterObj: Record<string, unknown> = isPlainObject(after) ? after : {};

  const allKeys = new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)]);
  const nodes: DiffNode[] = [];

  for (const key of allKeys) {
    const hasLeft = Object.prototype.hasOwnProperty.call(beforeObj, key);
    const hasRight = Object.prototype.hasOwnProperty.call(afterObj, key);
    const left = beforeObj[key];
    const right = afterObj[key];

    if (!hasLeft) {
      nodes.push({ key, status: 'added', left: undefined, right, depth });
    } else if (!hasRight) {
      nodes.push({ key, status: 'removed', left, right: undefined, depth });
    } else if (isPlainObject(left) && isPlainObject(right)) {
      // Recurse into nested objects
      const children = diffObjects(left, right, depth + 1);
      const hasChange = children.some((c) => c.status !== 'unchanged');
      nodes.push({
        key,
        status: hasChange ? 'changed' : 'unchanged',
        left,
        right,
        children,
        depth,
      });
    } else {
      const same = JSON.stringify(left) === JSON.stringify(right);
      nodes.push({
        key,
        status: same ? 'unchanged' : 'changed',
        left,
        right,
        depth,
      });
    }
  }

  return nodes;
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatValue(v: unknown): string {
  if (v === undefined) return '—';
  if (typeof v === 'string') return JSON.stringify(v);
  return JSON.stringify(v, null, 0);
}

// ── Status colors ─────────────────────────────────────────────────────────────

const STATUS_LEFT_COLOR: Record<DiffStatus, string | undefined> = {
  unchanged: undefined,
  changed: 'red',
  added: undefined,
  removed: 'red',
};

const STATUS_RIGHT_COLOR: Record<DiffStatus, string | undefined> = {
  unchanged: undefined,
  changed: 'green',
  added: 'green',
  removed: undefined,
};

// ── Single row ────────────────────────────────────────────────────────────────

function DiffRow({ node, compact }: { node: DiffNode; compact: boolean }) {
  if (compact && node.status === 'unchanged') return null;

  const indent = node.depth * 16;
  const leftColor = STATUS_LEFT_COLOR[node.status];
  const rightColor = STATUS_RIGHT_COLOR[node.status];

  // If this node has children (nested object), render a section header + children
  if (node.children) {
    return (
      <>
        <Box style={{ paddingLeft: indent }}>
          <Text size="xs" fw={600} c="var(--mantine-color-gray-7)" ff="monospace">
            {node.key}:
          </Text>
        </Box>
        <Box style={{ paddingLeft: indent }}>
          <Text size="xs" fw={600} c="var(--mantine-color-gray-7)" ff="monospace">
            {node.key}:
          </Text>
        </Box>
        {node.children.map((child) => (
          <DiffRow key={child.key} node={child} compact={compact} />
        ))}
      </>
    );
  }

  return (
    <>
      {/* Left (before) */}
      <Box
        px={6}
        py={2}
        style={(theme) => ({
          paddingLeft: indent + 6,
          backgroundColor:
            node.status === 'changed' || node.status === 'removed'
              ? theme.colors.red[0]
              : undefined,
          borderRadius: 2,
        })}
      >
        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="var(--mantine-color-gray-7)" ff="monospace" style={{ minWidth: 80 }}>
            {node.key}:
          </Text>
          <Text
            size="xs"
            {...(leftColor
              ? { c: leftColor }
              : node.status === 'added'
                ? { c: 'dimmed' as const }
                : {})}
            ff="monospace"
            style={{ wordBreak: 'break-all' }}
          >
            {node.status === 'added' ? '—' : formatValue(node.left)}
          </Text>
        </Group>
      </Box>

      {/* Right (after) */}
      <Box
        px={6}
        py={2}
        style={(theme) => ({
          paddingLeft: indent + 6,
          backgroundColor:
            node.status === 'changed' || node.status === 'added'
              ? theme.colors.green[0]
              : undefined,
          borderRadius: 2,
        })}
      >
        <Group gap={4} wrap="nowrap">
          <Text size="xs" c="var(--mantine-color-gray-7)" ff="monospace" style={{ minWidth: 80 }}>
            {node.key}:
          </Text>
          <Text
            size="xs"
            {...(rightColor
              ? { c: rightColor }
              : node.status === 'removed'
                ? { c: 'dimmed' as const }
                : {})}
            ff="monospace"
            style={{ wordBreak: 'break-all' }}
          >
            {node.status === 'removed' ? '—' : formatValue(node.right)}
          </Text>
        </Group>
      </Box>
    </>
  );
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface DiffViewProps {
  before: unknown;
  after: unknown;
  label?: string;
  /** 'json' renders before/after as parsed JSON objects. 'auto' is the default — auto-detects. */
  format?: 'json' | 'auto';
  /** When true, hides unchanged keys. Default: false. */
  compact?: boolean;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function DiffView({
  before,
  after,
  label,
  format: _format = 'auto',
  compact = false,
}: DiffViewProps) {
  const nodes = useMemo(() => diffObjects(before, after), [before, after]);

  const changedCount = nodes.filter((n) => n.status !== 'unchanged').length;
  const visibleNodes = compact ? nodes.filter((n) => n.status !== 'unchanged') : nodes;

  return (
    <Paper withBorder radius="sm" p="sm" data-testid="diff-view">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <Stack gap={4} mb="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            {label ?? 'Changes'}
          </Text>
          <Badge size="sm" color={changedCount > 0 ? 'orange' : 'gray'} variant="light">
            {changedCount} changed
          </Badge>
        </Group>
        <SimpleGrid cols={2} spacing={0}>
          <Text
            size="xs"
            fw={500}
            c="var(--mantine-color-gray-7)"
            ta="center"
            py={4}
            style={(theme) => ({
              borderBottom: `1px solid ${theme.colors.gray[3]}`,
              backgroundColor: theme.colors.red[0],
            })}
          >
            Before
          </Text>
          <Text
            size="xs"
            fw={500}
            c="var(--mantine-color-gray-7)"
            ta="center"
            py={4}
            style={(theme) => ({
              borderBottom: `1px solid ${theme.colors.gray[3]}`,
              backgroundColor: theme.colors.green[0],
            })}
          >
            After
          </Text>
        </SimpleGrid>
      </Stack>

      {/* ── Diff rows — SimpleGrid binds left+right pairs ────────────────── */}
      <SimpleGrid cols={2} spacing={0} data-testid="diff-rows">
        {visibleNodes.map((node) => (
          <DiffRow key={node.key} node={node} compact={compact} />
        ))}
      </SimpleGrid>

      {compact && changedCount === 0 && (
        <Text size="xs" c="var(--mantine-color-gray-7)" ta="center" py="xs">
          No changes
        </Text>
      )}
    </Paper>
  );
}
