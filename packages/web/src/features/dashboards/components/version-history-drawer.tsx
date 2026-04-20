/**
 * <VersionHistoryDrawer> — list + side-by-side diff + restore UI for a
 * dashboard's version history.
 *
 * Layout:
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │ Drawer header: "Version history — <dashboard name>"      │
 *   ├────────────┬─────────────────────────────────────────────┤
 *   │ Version    │ Right pane: details / diff / restore button │
 *   │ list       │                                             │
 *   │ (click to  │                                             │
 *   │ select up  │                                             │
 *   │ to 2)      │                                             │
 *   └────────────┴─────────────────────────────────────────────┘
 *
 * Selection rules:
 *   - 1 version selected → show pretty-printed snapshot + Restore button.
 *   - 2 versions selected → show side-by-side JSON diff with a naive
 *     line-level highlight for any mismatched lines.
 *   - 3rd click on a version replaces the older of the two previous
 *     selections (so the user can cycle through comparisons quickly).
 *
 * Restore path: opens a typed-confirm modal (user types "restore") before
 * calling `restoreDashboardVersion`. On success the drawer auto-closes and
 * `onRestored` fires, letting the caller navigate.
 *
 * Permissions:
 *   - Listing requires no extra permission beyond what the viewer already has.
 *   - Restore is gated on `dashboard:write` (disabled + tooltip otherwise).
 */
import { useCallback, useMemo, useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Button,
  Drawer,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertTriangle,
  IconHistory,
  IconRefresh,
  IconRestore,
  IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useMockStore } from '@/api/mock-store';
import type {
  Dashboard,
  DashboardVersion,
} from '@/api/resources/types';
import {
  restoreDashboardVersion,
  useDashboardVersions,
} from '../api';

dayjs.extend(relativeTime);

// ─── Props ────────────────────────────────────────────────────────────────────

export interface VersionHistoryDrawerProps {
  opened: boolean;
  onClose: () => void;
  dashboard: Dashboard;
  /** Called after a successful restore. Caller typically navigates to viewer. */
  onRestored?: (dashboard: Dashboard) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function prettyPrint(v: DashboardVersion): string {
  return JSON.stringify(v.snapshot, null, 2);
}

interface DiffLine {
  left: string;
  right: string;
  changed: boolean;
}

function lineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split('\n');
  const bLines = b.split('\n');
  const max = Math.max(aLines.length, bLines.length);
  const out: DiffLine[] = [];
  for (let i = 0; i < max; i++) {
    const left = aLines[i] ?? '';
    const right = bLines[i] ?? '';
    out.push({ left, right, changed: left !== right });
  }
  return out;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function VersionHistoryDrawer({
  opened,
  onClose,
  dashboard,
  onRestored,
}: VersionHistoryDrawerProps) {
  const canWrite = usePermission('dashboard:write');
  const versions = useDashboardVersions(dashboard.id);
  const users = useMockStore((s) => s.users);

  // Up to two version ids (versionA is "older-clicked", versionB is "newer-clicked").
  const [selected, setSelected] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [restoring, setRestoring] = useState(false);

  const selectedVersions: DashboardVersion[] = useMemo(
    () =>
      selected
        .map((id) => versions.find((v) => v.id === id))
        .filter((v): v is DashboardVersion => Boolean(v)),
    [selected, versions],
  );

  const handleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      if (prev.includes(id)) {
        // Toggle off.
        return prev.filter((x) => x !== id);
      }
      if (prev.length < 2) return [...prev, id];
      // Replace the oldest (first) entry.
      return [prev[1]!, id];
    });
  }, []);

  const handleRestore = useCallback(async () => {
    if (selectedVersions.length !== 1) return;
    const v = selectedVersions[0]!;
    setRestoring(true);
    try {
      const restored = await restoreDashboardVersion(v.id);
      notify.success(
        'Dashboard restored',
        `Restored to version ${String(v.version)}.`,
      );
      setConfirmOpen(false);
      setTyped('');
      setSelected([]);
      onClose();
      onRestored?.(restored);
    } catch (e) {
      notify.error('Restore failed', (e as Error).message);
    } finally {
      setRestoring(false);
    }
  }, [selectedVersions, onClose, onRestored]);

  const leftDoc = selectedVersions[0] ? prettyPrint(selectedVersions[0]) : '';
  const rightDoc = selectedVersions[1] ? prettyPrint(selectedVersions[1]) : '';
  const diffLines = useMemo(
    () => (selectedVersions.length === 2 ? lineDiff(leftDoc, rightDoc) : []),
    [leftDoc, rightDoc, selectedVersions.length],
  );

  return (
    <>
      <Drawer
        opened={opened}
        onClose={onClose}
        position="right"
        size="xl"
        title={
          <Group gap="xs">
            <IconHistory size={18} />
            <Title order={5}>Version history — {dashboard.name}</Title>
          </Group>
        }
        withCloseButton
        data-testid="version-history-drawer"
      >
        <Box
          style={{
            display: 'grid',
            gridTemplateColumns: '260px 1fr',
            gap: 'var(--mantine-spacing-md)',
            height: 'calc(100vh - 120px)',
            minHeight: 0,
          }}
        >
          {/* Version list */}
          <ScrollArea type="auto">
            <Stack gap="xs">
              {versions.length === 0 ? (
                <Alert color="gray" variant="light">
                  <Text size="sm">No versions yet for this dashboard.</Text>
                </Alert>
              ) : (
                versions.map((v) => {
                  const isSelected = selected.includes(v.id);
                  const createdByUser = users[v.created_by];
                  const absolute = dayjs(v.created_at).format(
                    'YYYY-MM-DD HH:mm:ss',
                  );
                  return (
                    <Box
                      key={v.id}
                      component="button"
                      type="button"
                      onClick={() => {
                        handleSelect(v.id);
                      }}
                      data-testid={`version-history-row-${String(v.version)}`}
                      aria-pressed={isSelected}
                      aria-label={`Version ${String(v.version)}`}
                      style={{
                        textAlign: 'left',
                        padding: 'var(--mantine-spacing-xs)',
                        borderRadius: 'var(--mantine-radius-sm)',
                        border: isSelected
                          ? '2px solid var(--mantine-color-violet-5)'
                          : '1px solid var(--mantine-color-default-border)',
                        background: isSelected
                          ? 'var(--mantine-color-violet-0)'
                          : 'var(--mantine-color-body)',
                        cursor: 'pointer',
                      }}
                    >
                      <Stack gap={4}>
                        <Group gap="xs" justify="space-between">
                          <Badge
                            size="sm"
                            variant="light"
                            color={isSelected ? 'violet' : 'gray'}
                          >
                            v{String(v.version)}
                          </Badge>
                          {v.description !== undefined && (
                            <Text size="xs" c="var(--mantine-color-gray-7)" lineClamp={1}>
                              {v.description}
                            </Text>
                          )}
                        </Group>
                        <Tooltip label={absolute} withArrow>
                          <Text size="xs" ff="monospace">
                            {dayjs(v.created_at).fromNow()}
                          </Text>
                        </Tooltip>
                        <Text size="xs" c="var(--mantine-color-gray-7)">
                          by {createdByUser?.name ?? v.created_by}
                        </Text>
                      </Stack>
                    </Box>
                  );
                })
              )}
            </Stack>
          </ScrollArea>

          {/* Right pane: detail / diff / actions */}
          <Stack gap="sm" style={{ minHeight: 0 }}>
            {selectedVersions.length === 0 && (
              <Alert color="blue" variant="light">
                <Text size="sm">
                  Select a version on the left to view its snapshot, or select
                  two to compare side-by-side.
                </Text>
              </Alert>
            )}

            {selectedVersions.length === 1 && (
              <Stack gap="sm" style={{ minHeight: 0 }}>
                <Group justify="space-between" align="center">
                  <Text size="sm" fw={500}>
                    Snapshot of v{String(selectedVersions[0]!.version)}
                  </Text>
                  <Group gap="xs">
                    <Tooltip label="Clear selection" withArrow>
                      <ActionIcon
                        variant="subtle"
                        aria-label="Clear version selection"
                        onClick={() => {
                          setSelected([]);
                        }}
                      >
                        <IconX size={14} />
                      </ActionIcon>
                    </Tooltip>
                    <Tooltip
                      label={
                        canWrite
                          ? 'Restore this version as the current dashboard'
                          : 'Requires dashboard:write'
                      }
                      withArrow
                    >
                      <Button
                        size="xs"
                        leftSection={<IconRestore size={14} />}
                        disabled={!canWrite}
                        onClick={() => {
                          setConfirmOpen(true);
                        }}
                        data-testid="version-history-restore"
                      >
                        Restore this version
                      </Button>
                    </Tooltip>
                  </Group>
                </Group>
                <ScrollArea type="auto" style={{ flex: 1, minHeight: 0 }}>
                  <Box
                    component="pre"
                    style={{
                      margin: 0,
                      padding: 'var(--mantine-spacing-sm)',
                      fontSize: 12,
                      fontFamily: 'var(--mantine-font-family-monospace)',
                      background: 'var(--mantine-color-gray-0)',
                      borderRadius: 'var(--mantine-radius-sm)',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                    data-testid="version-history-snapshot"
                  >
                    {leftDoc}
                  </Box>
                </ScrollArea>
              </Stack>
            )}

            {selectedVersions.length === 2 && (
              <Stack gap="sm" style={{ minHeight: 0 }}>
                <Group gap="xs">
                  <Badge size="sm" variant="light" color="red">
                    v{String(selectedVersions[0]!.version)}
                  </Badge>
                  <Text size="xs" c="var(--mantine-color-gray-7)">
                    versus
                  </Text>
                  <Badge size="sm" variant="light" color="green">
                    v{String(selectedVersions[1]!.version)}
                  </Badge>
                  <Tooltip label="Clear selection" withArrow>
                    <ActionIcon
                      variant="subtle"
                      aria-label="Clear version selection"
                      onClick={() => {
                        setSelected([]);
                      }}
                    >
                      <IconRefresh size={14} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
                <ScrollArea type="auto" style={{ flex: 1, minHeight: 0 }}>
                  <Box
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 2,
                      fontFamily: 'var(--mantine-font-family-monospace)',
                      fontSize: 12,
                    }}
                    data-testid="version-history-diff"
                  >
                    {diffLines.map((ln, i) => (
                      <DiffRow key={i} line={ln} />
                    ))}
                  </Box>
                </ScrollArea>
              </Stack>
            )}
          </Stack>
        </Box>
      </Drawer>

      {/* Typed-confirm restore modal */}
      <Modal
        opened={confirmOpen}
        onClose={() => {
          setConfirmOpen(false);
          setTyped('');
        }}
        title="Restore this version?"
        centered
      >
        <Stack gap="md">
          <Alert
            color="orange"
            variant="light"
            icon={<IconAlertTriangle size={16} />}
          >
            <Text size="sm">
              Restoring replaces the current dashboard + widgets with the
              snapshot. A new version marker will be written to history so
              this action is itself reversible.
            </Text>
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              restore
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={typed}
            onChange={(e) => {
              setTyped(e.currentTarget.value);
            }}
            aria-label="Confirm restore"
            data-testid="version-history-restore-confirm"
            data-autofocus
          />
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setConfirmOpen(false);
                setTyped('');
              }}
              disabled={restoring}
            >
              Cancel
            </Button>
            <Button
              loading={restoring}
              disabled={typed !== 'restore' || !canWrite}
              onClick={() => {
                void handleRestore();
              }}
              data-testid="version-history-restore-confirm-btn"
            >
              Restore
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}

// ─── Row for the diff pane ────────────────────────────────────────────────────

function DiffRow({ line }: { line: DiffLine }) {
  const bgLeft = line.changed
    ? 'var(--mantine-color-red-1)'
    : 'var(--mantine-color-body)';
  const bgRight = line.changed
    ? 'var(--mantine-color-green-1)'
    : 'var(--mantine-color-body)';
  return (
    <>
      <Box
        style={{
          padding: '2px 6px',
          background: bgLeft,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {line.left}
      </Box>
      <Box
        style={{
          padding: '2px 6px',
          background: bgRight,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
        }}
      >
        {line.right}
      </Box>
    </>
  );
}
