/**
 * <DashboardRangePicker> — time range selector with three modes.
 *
 * Trigger: a compact button showing the current range's short label + caret.
 * Body has three tabs:
 *   1. Quick presets    — segmented control of canonical short windows.
 *   2. Past N <unit>    — number input + unit Select (hour/day/week/month/quarter/year).
 *   3. Absolute range   — two DateTimePickers (start + end).
 *
 * Responsive: renders as a Popover on >=sm screens and as a full-width Modal
 * on mobile. The Mantine DateTimePicker calendar is portalled with a high
 * z-index so it never gets clipped by the parent surface.
 */
import { useState, useEffect, useMemo } from 'react';
import {
  Button,
  Modal,
  Popover,
  Stack,
  Group,
  Text,
  SegmentedControl,
  NumberInput,
  Select,
  Divider,
  useMatches,
} from '@mantine/core';
import { DateTimePicker } from '@mantine/dates';
import { IconChevronDown, IconClock } from '@tabler/icons-react';
import dayjs from 'dayjs';
import type { DashboardRangeSpec, DashboardRangeUnit } from '@/api/resources';
import { specToTimeRange } from '@/hooks/use-dashboard-range';

const PRESET_OPTIONS = [
  { value: '1h', label: '1h' },
  { value: '6h', label: '6h' },
  { value: '24h', label: '24h' },
  { value: '7d', label: '7d' },
  { value: '30d', label: '30d' },
  { value: '90d', label: '90d' },
] as const;

const UNIT_OPTIONS: { value: DashboardRangeUnit; label: string }[] = [
  { value: 'hour', label: 'Hours' },
  { value: 'day', label: 'Days' },
  { value: 'week', label: 'Weeks' },
  { value: 'month', label: 'Months' },
  { value: 'quarter', label: 'Quarters' },
  { value: 'year', label: 'Years' },
];

type Tab = 'preset' | 'relative' | 'absolute';

interface DashboardRangePickerProps {
  value: DashboardRangeSpec;
  onChange: (next: DashboardRangeSpec) => void;
}

export function DashboardRangePicker({ value, onChange }: DashboardRangePickerProps) {
  const [opened, setOpened] = useState(false);
  const [tab, setTab] = useState<Tab>(() => initialTab(value));
  // On mobile, render the picker body inside a Modal — Popovers + nested
  // calendar dropdowns are unusable at <sm widths.
  const isMobile = useMatches({ base: true, sm: false });

  // Drafts per-tab so switching tabs doesn't blow away in-progress edits.
  const [draftPreset, setDraftPreset] = useState<DashboardRangeSpec>(() =>
    value.kind === 'preset' ? value : { kind: 'preset', id: '24h' },
  );
  const [draftRelativeAmount, setDraftRelativeAmount] = useState<number>(() =>
    value.kind === 'relative' ? value.amount : 7,
  );
  const [draftRelativeUnit, setDraftRelativeUnit] = useState<DashboardRangeUnit>(() =>
    value.kind === 'relative' ? value.unit : 'day',
  );
  const [draftFrom, setDraftFrom] = useState<Date | null>(() =>
    value.kind === 'absolute' ? new Date(value.from) : dayjs().subtract(7, 'day').toDate(),
  );
  const [draftTo, setDraftTo] = useState<Date | null>(() =>
    value.kind === 'absolute' ? new Date(value.to) : new Date(),
  );

  // Sync drafts when `value` changes externally (e.g. dashboard switch).
  // Bounded — fires only when the prop reference changes, not every render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setTab(initialTab(value));
    if (value.kind === 'preset') setDraftPreset(value);
    if (value.kind === 'relative') {
      setDraftRelativeAmount(value.amount);
      setDraftRelativeUnit(value.unit);
    }
    if (value.kind === 'absolute') {
      setDraftFrom(new Date(value.from));
      setDraftTo(new Date(value.to));
    }
  }, [value]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const triggerLabel = useMemo(() => specToTimeRange(value).label, [value]);
  const longLabel = useMemo(() => specToTimeRange(value).longLabel, [value]);

  function handleApply() {
    if (tab === 'preset') {
      onChange(draftPreset);
    } else if (tab === 'relative') {
      const amount = Math.max(1, Math.floor(draftRelativeAmount));
      onChange({ kind: 'relative', amount, unit: draftRelativeUnit });
    } else {
      if (!draftFrom || !draftTo) return;
      const from = draftFrom.toISOString();
      const to = draftTo.toISOString();
      if (dayjs(from).isAfter(dayjs(to))) return;
      onChange({ kind: 'absolute', from, to });
    }
    setOpened(false);
  }

  const applyDisabled =
    tab === 'absolute' &&
    (!draftFrom ||
      !draftTo ||
      dayjs(draftFrom.toISOString()).isAfter(dayjs(draftTo.toISOString())));

  const trigger = (
    <Button
      variant="default"
      size="xs"
      leftSection={<IconClock size={14} />}
      rightSection={<IconChevronDown size={14} />}
      onClick={() => {
        setOpened((o) => !o);
      }}
      data-testid="dashboard-range-picker-trigger"
      aria-label={`Time range: ${longLabel}`}
    >
      {triggerLabel}
    </Button>
  );

  const body = (
    <Stack gap="sm">
      <SegmentedControl
        size="xs"
        fullWidth
        value={tab}
        onChange={(v) => {
          setTab(v);
        }}
        data={[
          { value: 'preset', label: 'Quick' },
          { value: 'relative', label: 'Past N' },
          { value: 'absolute', label: 'Absolute' },
        ]}
      />

      {tab === 'preset' && (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Common windows
          </Text>
          <SegmentedControl
            size="xs"
            fullWidth
            value={draftPreset.kind === 'preset' ? draftPreset.id : '24h'}
            onChange={(v) => {
              setDraftPreset({
                kind: 'preset',
                id: v as DashboardRangeSpec extends { kind: 'preset'; id: infer X } ? X : never,
              });
            }}
            data={PRESET_OPTIONS as unknown as { value: string; label: string }[]}
          />
        </Stack>
      )}

      {tab === 'relative' && (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Past N
          </Text>
          <Group gap="xs" align="flex-end" grow>
            <NumberInput
              label="Amount"
              size="sm"
              min={1}
              max={9999}
              value={draftRelativeAmount}
              onChange={(v) => {
                const n = typeof v === 'number' ? v : parseInt(v, 10);
                if (!Number.isNaN(n)) setDraftRelativeAmount(n);
              }}
              data-testid="dashboard-range-relative-amount"
            />
            <Select
              label="Unit"
              size="sm"
              data={UNIT_OPTIONS}
              value={draftRelativeUnit}
              onChange={(v) => {
                if (v) setDraftRelativeUnit(v);
              }}
              allowDeselect={false}
              comboboxProps={{ withinPortal: true, zIndex: 1100 }}
              data-testid="dashboard-range-relative-unit"
            />
          </Group>
        </Stack>
      )}

      {tab === 'absolute' && (
        <Stack gap="xs">
          <Text size="xs" c="dimmed">
            Absolute window
          </Text>
          <DateTimePicker
            label="From"
            size="sm"
            value={draftFrom}
            onChange={(v) => {
              setDraftFrom(v ? new Date(v) : null);
            }}
            popoverProps={{ withinPortal: true, zIndex: 1100 }}
            data-testid="dashboard-range-absolute-from"
          />
          <DateTimePicker
            label="To"
            size="sm"
            value={draftTo}
            onChange={(v) => {
              setDraftTo(v ? new Date(v) : null);
            }}
            popoverProps={{ withinPortal: true, zIndex: 1100 }}
            data-testid="dashboard-range-absolute-to"
          />
        </Stack>
      )}

      <Divider />
      <Group justify="space-between" wrap="wrap" gap="xs">
        <Text size="xs" c="dimmed">
          Showing {longLabel}
        </Text>
        <Group gap="xs">
          <Button
            variant="default"
            size="xs"
            onClick={() => {
              setOpened(false);
            }}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            onClick={handleApply}
            disabled={applyDisabled}
            data-testid="dashboard-range-apply"
          >
            Apply
          </Button>
        </Group>
      </Group>
    </Stack>
  );

  if (isMobile) {
    return (
      <>
        {trigger}
        <Modal
          opened={opened}
          onClose={() => {
            setOpened(false);
          }}
          title="Time range"
          size="sm"
          fullScreen={false}
          centered
          // Explicit z-index so DateTimePicker portal (1100) appears above.
          zIndex={1000}
        >
          {body}
        </Modal>
      </>
    );
  }

  return (
    <Popover
      opened={opened}
      onChange={setOpened}
      position="bottom-end"
      withinPortal
      shadow="md"
      width={360}
    >
      <Popover.Target>{trigger}</Popover.Target>
      <Popover.Dropdown>{body}</Popover.Dropdown>
    </Popover>
  );
}

function initialTab(value: DashboardRangeSpec): Tab {
  if (value.kind === 'preset') return 'preset';
  if (value.kind === 'relative') return 'relative';
  return 'absolute';
}
