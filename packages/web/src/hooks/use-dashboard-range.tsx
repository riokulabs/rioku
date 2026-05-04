/**
 * Dashboard time-range context.
 *
 * Owns the currently-selected time window for a rendered dashboard. Widgets
 * read the active range via `useDashboardRange()` and pass it down to the
 * query pipeline, which forwards it into the mock adapter via
 * `widget.config._range`.
 *
 * The range is dashboard-local: each DashboardViewer owns its own provider
 * so two dashboards on the same page can show different ranges without
 * interfering with each other.
 *
 * The user-facing range is a `DashboardRangeSpec` (preset / relative / absolute).
 * For widget consumption we compute a derived `TimeRange` (seconds, points,
 * formatTick) so adapters don't need to know the spec shape.
 */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import dayjs from 'dayjs';
import type { DashboardRangeSpec, DashboardRangeUnit } from '@/api/resources/types';

export type TimeRangeId = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';

export interface TimeRange {
  id: string;
  /** Short label shown inside the trigger ("1h", "30d", "Custom"). */
  label: string;
  /** Long label shown in sub-text / titles ("last 7 days"). */
  longLabel: string;
  /** Window size in seconds — used by mock adapters to size mock trends. */
  seconds: number;
  /** Suggested point count for time-series / area charts. */
  points: number;
  /** Per-point bucket label formatter for the x-axis. */
  formatTick: (index: number, total: number) => string;
}

// ─── Preset table ─────────────────────────────────────────────────────────────

interface PresetSpec {
  id: TimeRangeId;
  label: string;
  longLabel: string;
  seconds: number;
  points: number;
  formatTick: (index: number, total: number) => string;
}

const HOUR_S = 3600;
const DAY_S = 86_400;

const PRESETS: readonly [PresetSpec, ...PresetSpec[]] = [
  {
    id: '1h',
    label: '1h',
    longLabel: 'last hour',
    seconds: HOUR_S,
    points: 60,
    formatTick: (i, total) => `${String(total - 1 - i)}m`,
  },
  {
    id: '6h',
    label: '6h',
    longLabel: 'last 6 hours',
    seconds: 6 * HOUR_S,
    points: 36,
    formatTick: (i, total) => `${String((total - 1 - i) * 10)}m`,
  },
  {
    id: '24h',
    label: '24h',
    longLabel: 'last 24 hours',
    seconds: DAY_S,
    points: 24,
    formatTick: (i) => {
      const hour = new Date(Date.now() - (23 - i) * 3_600_000);
      return `${hour.getHours().toString().padStart(2, '0')}:00`;
    },
  },
  {
    id: '7d',
    label: '7d',
    longLabel: 'last 7 days',
    seconds: 7 * DAY_S,
    points: 28,
    formatTick: (i, total) => {
      const hoursAgo = (total - 1 - i) * 6;
      const d = new Date(Date.now() - hoursAgo * 3_600_000);
      return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
    },
  },
  {
    id: '30d',
    label: '30d',
    longLabel: 'last 30 days',
    seconds: 30 * DAY_S,
    points: 30,
    formatTick: (i) => {
      const d = new Date(Date.now() - (29 - i) * 86_400_000);
      return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
    },
  },
  {
    id: '90d',
    label: '90d',
    longLabel: 'last 90 days',
    seconds: 90 * DAY_S,
    points: 45,
    formatTick: (i, total) => {
      const daysAgo = (total - 1 - i) * 2;
      const d = new Date(Date.now() - daysAgo * 86_400_000);
      return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
    },
  },
];

/** Backwards-compat: old code expects `TIME_RANGES` as the segmented-control source. */
export const TIME_RANGES: readonly TimeRange[] = PRESETS.map((p) => ({
  id: p.id,
  label: p.label,
  longLabel: p.longLabel,
  seconds: p.seconds,
  points: p.points,
  formatTick: p.formatTick,
}));

const DEFAULT_PRESET: PresetSpec = PRESETS.find((p) => p.id === '24h') ?? PRESETS[0];

const DEFAULT_RANGE: TimeRange = {
  id: DEFAULT_PRESET.id,
  label: DEFAULT_PRESET.label,
  longLabel: DEFAULT_PRESET.longLabel,
  seconds: DEFAULT_PRESET.seconds,
  points: DEFAULT_PRESET.points,
  formatTick: DEFAULT_PRESET.formatTick,
};

// ─── Spec → TimeRange ─────────────────────────────────────────────────────────

const UNIT_SECONDS: Record<DashboardRangeUnit, number> = {
  hour: HOUR_S,
  day: DAY_S,
  week: 7 * DAY_S,
  month: 30 * DAY_S,
  quarter: 91 * DAY_S,
  year: 365 * DAY_S,
};

const UNIT_LABELS_SINGULAR: Record<DashboardRangeUnit, string> = {
  hour: 'hour',
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
};

function pluralize(n: number, unit: DashboardRangeUnit): string {
  const s = UNIT_LABELS_SINGULAR[unit];
  return n === 1 ? s : `${s}s`;
}

/** Choose a sensible point count + tick formatter for an arbitrary window in seconds. */
function autoBuckets(seconds: number): {
  points: number;
  formatTick: (i: number, total: number) => string;
} {
  if (seconds <= HOUR_S) {
    return {
      points: 60,
      formatTick: (i, total) => `${String(total - 1 - i)}m`,
    };
  }
  if (seconds <= DAY_S) {
    return {
      points: 24,
      formatTick: (i, total) => {
        const hour = new Date(Date.now() - (total - 1 - i) * 3_600_000);
        return `${hour.getHours().toString().padStart(2, '0')}:00`;
      },
    };
  }
  if (seconds <= 30 * DAY_S) {
    return {
      points: 30,
      formatTick: (i, total) => {
        const d = new Date(Date.now() - (total - 1 - i) * 86_400_000);
        return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
      },
    };
  }
  return {
    points: 45,
    formatTick: (i, total) => {
      const daysAgo = (total - 1 - i) * Math.ceil(seconds / DAY_S / 45);
      const d = new Date(Date.now() - daysAgo * 86_400_000);
      return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
    },
  };
}

export function specToTimeRange(spec: DashboardRangeSpec): TimeRange {
  if (spec.kind === 'preset') {
    const p = PRESETS.find((x) => x.id === spec.id);
    if (p) {
      return {
        id: p.id,
        label: p.label,
        longLabel: p.longLabel,
        seconds: p.seconds,
        points: p.points,
        formatTick: p.formatTick,
      };
    }
    return DEFAULT_RANGE;
  }
  if (spec.kind === 'relative') {
    const seconds = spec.amount * UNIT_SECONDS[spec.unit];
    const buckets = autoBuckets(seconds);
    return {
      id: `relative:${String(spec.amount)}${spec.unit}`,
      label: `${String(spec.amount)}${spec.unit.charAt(0)}`,
      longLabel: `last ${String(spec.amount)} ${pluralize(spec.amount, spec.unit)}`,
      seconds,
      points: buckets.points,
      formatTick: buckets.formatTick,
    };
  }
  // absolute
  const from = dayjs(spec.from);
  const to = dayjs(spec.to);
  const seconds = Math.max(60, to.diff(from, 'second'));
  const buckets = autoBuckets(seconds);
  return {
    id: `abs:${spec.from}:${spec.to}`,
    label: 'Custom',
    longLabel: `${from.format('MMM D, HH:mm')} → ${to.format('MMM D, HH:mm')}`,
    seconds,
    points: buckets.points,
    formatTick: buckets.formatTick,
  };
}

export function getTimeRange(id: TimeRangeId): TimeRange {
  const found = TIME_RANGES.find((r) => r.id === id);
  return found ?? DEFAULT_RANGE;
}

// ─── Context ──────────────────────────────────────────────────────────────────

interface DashboardRangeContextValue {
  /** The user-selected spec (preset / relative / absolute). */
  spec: DashboardRangeSpec;
  /** Derived TimeRange used by widgets. */
  range: TimeRange;
  /** Replace the full spec. */
  setSpec: (next: DashboardRangeSpec) => void;
  /** Convenience: replace a preset-id spec. */
  setRangeId: (id: string) => void;
}

const DashboardRangeContext = createContext<DashboardRangeContextValue | null>(null);

const DEFAULT_SPEC: DashboardRangeSpec = { kind: 'preset', id: '24h' };

export function useDashboardRange(): DashboardRangeContextValue {
  const ctx = useContext(DashboardRangeContext);
  if (ctx) return ctx;
  return {
    spec: DEFAULT_SPEC,
    range: DEFAULT_RANGE,
    setSpec: () => {
      /* no-op */
    },
    setRangeId: () => {
      /* no-op */
    },
  };
}

interface DashboardRangeProviderProps {
  /** Initial spec — usually the dashboard's `default_range`. */
  initialSpec?: DashboardRangeSpec;
  /** Backwards-compat: initial preset id. Ignored when `initialSpec` is set. */
  initialRangeId?: TimeRangeId;
  children: ReactNode;
}

export function DashboardRangeProvider({
  initialSpec,
  initialRangeId,
  children,
}: DashboardRangeProviderProps) {
  const [spec, setSpec] = useState<DashboardRangeSpec>(() => {
    if (initialSpec) return initialSpec;
    if (initialRangeId) return { kind: 'preset', id: initialRangeId };
    return DEFAULT_SPEC;
  });
  const value = useMemo<DashboardRangeContextValue>(
    () => ({
      spec,
      range: specToTimeRange(spec),
      setSpec,
      setRangeId: (id: string) => {
        const presetId = id as TimeRangeId;
        if (PRESETS.some((p) => p.id === presetId)) {
          setSpec({ kind: 'preset', id: presetId });
        }
      },
    }),
    [spec],
  );
  return <DashboardRangeContext.Provider value={value}>{children}</DashboardRangeContext.Provider>;
}
