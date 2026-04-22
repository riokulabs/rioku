/**
 * <MultiSelectAsync> — shared primitive for unbounded-cardinality MultiSelects.
 *
 * Wraps Mantine's Combobox + PillsInput primitives to provide a searchable,
 * paginated MultiSelect whose option set is fetched lazily via `searchFn`.
 * The component only stores the opaque handle for each selected value; the
 * matching human label is resolved on-demand from the fetched pages and an
 * internal label cache. This matches the §13.2a opaque-handle carve-out:
 *   - URLs / state carry handles only, never PII labels
 *   - labels are fetched on render and cached in memory
 *
 * Pagination uses a cursor string (opaque to the caller). The load-more
 * trigger is a "Load more" button at the bottom of the dropdown — simpler
 * and more accessible than intersection-observer auto-paging, and works
 * under jsdom without fragile mocks.
 *
 * Intentionally does NOT support single-select — single-select has a
 * different interaction pattern (no pill removal, clear button instead).
 */
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Combobox,
  Pill,
  PillsInput,
  Text,
  useCombobox,
  Button,
  Loader,
  Group,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';

/** Shape returned by the `searchFn` callback — one page of candidates. */
export interface MultiSelectAsyncPage {
  items: { handle: string; label: string }[];
  nextCursor?: string;
}

export interface MultiSelectAsyncProps {
  label?: string;
  placeholder?: string;
  /** Selected values — opaque handles. */
  value: string[];
  /** Invoked when the selection changes. */
  onChange: (handles: string[]) => void;
  /**
   * Async candidate search. Receives the current query string (possibly
   * empty) and an optional pagination cursor; returns a page of candidates.
   */
  searchFn: (query: string, cursor?: string) => Promise<MultiSelectAsyncPage>;
  /** Debounce delay for search-input → fetch. Default 250ms. */
  debounceMs?: number;
  /** Disables the input entirely. Pills are still visible (read-only). */
  disabled?: boolean;
  /** Custom renderer for each selected pill. Defaults to plain label text. */
  chipRenderer?: (handle: string, label: string) => ReactNode;
  /** a11y label, mirrored onto the wrapping PillsInput. */
  'aria-label'?: string;
  /** Test id forwarded to the outer PillsInput. */
  'data-testid'?: string;
}

/**
 * Human-readable fallback when a selected handle isn't yet resolved against
 * the current page of results. Callers can still identify the handle at a
 * glance — the codec keeps handles short (`user_<id>`, `res_<type>_<id>`).
 */
function fallbackLabel(handle: string): string {
  return handle;
}

export function MultiSelectAsync({
  label,
  placeholder,
  value,
  onChange,
  searchFn,
  debounceMs = 250,
  disabled,
  chipRenderer,
  'aria-label': ariaLabel,
  'data-testid': dataTestId,
}: MultiSelectAsyncProps) {
  const combobox = useCombobox({
    onDropdownClose: () => {
      combobox.resetSelectedOption();
    },
  });

  const [query, setQuery] = useState('');
  const [debouncedQuery] = useDebouncedValue(query, debounceMs);

  const [items, setItems] = useState<{ handle: string; label: string }[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);

  // Stable label cache so previously-seen handles still render a nice label
  // even after the user types a new query that drops them from `items`.
  // Stored in state (not a ref) so the React Compiler / strict hooks rule
  // for "no ref access during render" stays happy — the cache is a piece of
  // render-derived memoization, not a side-channel.
  const [labelCache, setLabelCache] = useState<Record<string, string>>({});

  const mergeIntoCache = useCallback((page: MultiSelectAsyncPage) => {
    setLabelCache((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const it of page.items) {
        if (next[it.handle] !== it.label) {
          next[it.handle] = it.label;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  // Abort previous in-flight fetches when the query changes so stale results
  // don't clobber fresh ones. We do this via a monotonic request id rather
  // than AbortController because `searchFn` is consumer-supplied.
  const requestIdRef = useRef(0);

  const runSearch = useCallback(
    async (q: string) => {
      const reqId = ++requestIdRef.current;
      setLoading(true);
      try {
        const page = await searchFn(q);
        if (requestIdRef.current !== reqId) return; // stale
        mergeIntoCache(page);
        setItems(page.items);
        setCursor(page.nextCursor);
        setHasMore(page.nextCursor !== undefined);
      } finally {
        if (requestIdRef.current === reqId) {
          setLoading(false);
        }
      }
    },
    [searchFn, mergeIntoCache],
  );

  // Kick off a search whenever the dropdown opens or the debounced query
  // changes while open. Closing the dropdown cancels nothing — the stale
  // guard above handles late arrivals. The `runSearch` call synchronously
  // transitions `loading` to true, which is intended (we want an immediate
  // spinner on dropdown-open) — disable the cascading-renders rule here
  // because the state update is bounded: it only fires once per query +
  // dropdown transition, not on every render.
  useEffect(() => {
    if (!combobox.dropdownOpened) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runSearch(debouncedQuery);
  }, [debouncedQuery, combobox.dropdownOpened, runSearch]);

  const loadMore = useCallback(async () => {
    if (!cursor || loading) return;
    const reqId = ++requestIdRef.current;
    setLoading(true);
    try {
      const page = await searchFn(debouncedQuery, cursor);
      if (requestIdRef.current !== reqId) return;
      mergeIntoCache(page);
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      setHasMore(page.nextCursor !== undefined);
    } finally {
      if (requestIdRef.current === reqId) {
        setLoading(false);
      }
    }
  }, [cursor, loading, searchFn, debouncedQuery, mergeIntoCache]);

  const selectedSet = useMemo(() => new Set(value), [value]);

  const handleToggle = useCallback(
    (handle: string) => {
      if (selectedSet.has(handle)) {
        onChange(value.filter((v) => v !== handle));
      } else {
        onChange([...value, handle]);
      }
    },
    [selectedSet, value, onChange],
  );

  const handleRemove = useCallback(
    (handle: string) => {
      onChange(value.filter((v) => v !== handle));
    },
    [value, onChange],
  );

  const pills = value.map((handle) => {
    const resolved = labelCache[handle] ?? fallbackLabel(handle);
    return (
      <Pill
        key={handle}
        withRemoveButton={!disabled}
        onRemove={() => {
          handleRemove(handle);
        }}
      >
        {chipRenderer ? chipRenderer(handle, resolved) : resolved}
      </Pill>
    );
  });

  const options = items.map((it) => {
    const active = selectedSet.has(it.handle);
    return (
      <Combobox.Option
        value={it.handle}
        key={it.handle}
        active={active}
        data-testid={`multi-select-async-option-${it.handle}`}
      >
        <Group gap="xs" wrap="nowrap">
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              border: '1px solid var(--mantine-color-gray-5)',
              borderRadius: 3,
              background: active ? 'var(--mantine-color-blue-5)' : 'transparent',
            }}
          />
          <Text size="sm">{it.label}</Text>
        </Group>
      </Combobox.Option>
    );
  });

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        handleToggle(val);
      }}
    >
      <Combobox.DropdownTarget>
        <PillsInput
          label={label}
          onClick={() => {
            if (!disabled) combobox.openDropdown();
          }}
          {...(disabled ? { disabled: true } : {})}
          {...(ariaLabel !== undefined ? { 'aria-label': ariaLabel } : {})}
          {...(dataTestId !== undefined ? { 'data-testid': dataTestId } : {})}
        >
          <Pill.Group>
            {pills}
            <Combobox.EventsTarget>
              <PillsInput.Field
                onFocus={() => {
                  if (!disabled) combobox.openDropdown();
                }}
                onBlur={() => {
                  combobox.closeDropdown();
                }}
                value={query}
                placeholder={value.length === 0 ? placeholder : undefined}
                onChange={(event) => {
                  setQuery(event.currentTarget.value);
                  combobox.openDropdown();
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Backspace' && query.length === 0 && value.length > 0) {
                    event.preventDefault();
                    const last = value[value.length - 1];
                    if (last) handleRemove(last);
                  }
                }}
                disabled={disabled}
              />
            </Combobox.EventsTarget>
          </Pill.Group>
        </PillsInput>
      </Combobox.DropdownTarget>

      <Combobox.Dropdown>
        <Combobox.Options>
          {options.length === 0 && !loading && <Combobox.Empty>No results</Combobox.Empty>}
          {options}
        </Combobox.Options>
        {(loading || hasMore) && (
          <Group p="xs" justify="center" gap="xs">
            {loading && <Loader size="xs" data-testid="multi-select-async-loading" />}
            {hasMore && !loading && (
              <Button
                size="compact-xs"
                variant="subtle"
                onClick={() => {
                  void loadMore();
                }}
                data-testid="multi-select-async-load-more"
              >
                Load more
              </Button>
            )}
          </Group>
        )}
      </Combobox.Dropdown>
    </Combobox>
  );
}
