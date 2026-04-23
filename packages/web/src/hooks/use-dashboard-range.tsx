/**
 * Dashboard time-range context.
 *
 * Owns the currently-selected time window for a rendered dashboard (1h,
 * 24h, 7d, etc.). Widgets read the active range via `useDashboardRange()`
 * and pass it down to the query pipeline (`runWidgetQuery`), which forwards
 * it into the mock adapter via `widget.config._range`.
 *
 * The range is dashboard-local: each DashboardViewer owns its own provider
 * so two dashboards on the same page (e.g. split view) can show different
 * ranges without interfering with each other.
 */
import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type TimeRangeId = '1h' | '6h' | '24h' | '7d' | '30d' | '90d';

export interface TimeRange {
  id: TimeRangeId;
  /** Short label shown inside the segmented control. */
  label: string;
  /** Long label shown in sub-text / titles ("last 7 days"). */
  longLabel: string;
  /** Window size in seconds — used by mock adapters to size mock trends. */
  seconds: number;
  /**
   * Suggested point count for time-series / area charts in this window.
   * Mock adapters use this to decide how many points to synthesise.
   */
  points: number;
  /**
   * Per-point bucket label formatter. Used by the mock adapter for the
   * x-axis. Index runs 0…points-1, oldest to newest.
   */
  formatTick: (index: number, total: number) => string;
}

const DEFAULT_RANGE: TimeRange = {
  id: '24h',
  label: '24h',
  longLabel: 'last 24 hours',
  seconds: 86_400,
  points: 24,
  formatTick: (i) => {
    const hour = new Date(Date.now() - (23 - i) * 3_600_000);
    return `${hour.getHours().toString().padStart(2, '0')}:00`;
  },
};

/** Ordered list of selectable ranges — renders left→right in the selector. */
export const TIME_RANGES: readonly TimeRange[] = [
  {
    id: '1h',
    label: '1h',
    longLabel: 'last hour',
    seconds: 3600,
    points: 60,
    formatTick: (i, total) => {
      const minsAgo = total - 1 - i;
      return `${String(minsAgo)}m`;
    },
  },
  {
    id: '6h',
    label: '6h',
    longLabel: 'last 6 hours',
    seconds: 6 * 3600,
    points: 36,
    formatTick: (i, total) => {
      const minsAgo = (total - 1 - i) * 10;
      return `${String(minsAgo)}m`;
    },
  },
  DEFAULT_RANGE,
  {
    id: '7d',
    label: '7d',
    longLabel: 'last 7 days',
    seconds: 7 * 86_400,
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
    seconds: 30 * 86_400,
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
    seconds: 90 * 86_400,
    points: 45,
    formatTick: (i, total) => {
      const daysAgo = (total - 1 - i) * 2;
      const d = new Date(Date.now() - daysAgo * 86_400_000);
      return `${String(d.getMonth() + 1)}/${String(d.getDate())}`;
    },
  },
];

export function getTimeRange(id: TimeRangeId): TimeRange {
  const found = TIME_RANGES.find((r) => r.id === id);
  // TIME_RANGES covers every member of TimeRangeId, so this is a safety net.
  return found ?? DEFAULT_RANGE;
}

interface DashboardRangeContextValue {
  range: TimeRange;
  setRangeId: (id: TimeRangeId) => void;
}

const DashboardRangeContext = createContext<DashboardRangeContextValue | null>(null);

/**
 * Read the active dashboard range. Returns the 24h default when no provider
 * is present (e.g. a widget rendered outside a DashboardViewer — e.g. the
 * dashboard-builder preview pane).
 */
export function useDashboardRange(): DashboardRangeContextValue {
  const ctx = useContext(DashboardRangeContext);
  if (ctx) return ctx;
  // Stub: stable default for rendering outside a provider.
  return {
    range: getTimeRange('24h'),
    setRangeId: () => {
      /* no-op */
    },
  };
}

interface DashboardRangeProviderProps {
  initialRangeId?: TimeRangeId;
  children: ReactNode;
}

export function DashboardRangeProvider({
  initialRangeId = '24h',
  children,
}: DashboardRangeProviderProps) {
  const [rangeId, setRangeId] = useState<TimeRangeId>(initialRangeId);
  const value = useMemo<DashboardRangeContextValue>(
    () => ({
      range: getTimeRange(rangeId),
      setRangeId,
    }),
    [rangeId],
  );
  return (
    <DashboardRangeContext.Provider value={value}>{children}</DashboardRangeContext.Provider>
  );
}
