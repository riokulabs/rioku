/**
 * <MarketplaceGrid> — browsable catalog of marketplace listings (Plan 6).
 *
 * Plan 1 shipped: text search + tag MultiSelect.
 * Plan 6 (Task 6b.7) adds:
 *   - Left category sidebar (derived from tags — each tag counts as a category
 *     with the number of listings). Clicking a category toggles it into the
 *     tag filter; clicking the "All" row clears tag filters.
 *   - "Verified publishers only" Switch (filters `listing.verified === true`).
 *   - Sort control: installs (default) | verified-first | alphabetical | recently added.
 *     Persists in the URL via `sort` search param.
 *
 * All state is URL-synced (q, tags, verified, sort) so that the chosen view
 * survives refresh/deep links.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Grid,
  Group,
  NavLink,
  Select,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconCircleCheck,
  IconDownload,
  IconLayoutGrid,
  IconSearch,
  IconShoppingBag,
  IconTags,
} from '@tabler/icons-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { EmptyState } from '@/components/empty-state';
import { useMarketplaceListings, useMarketplaceTags } from '../api';
import type { MarketplaceFilter, MarketplaceListing } from '../types';

interface MarketplaceGridProps {
  onInstall: (listing: MarketplaceListing) => void;
}

/** Valid sort modes. Persisted to the URL as `sort=<mode>`. */
type SortMode = 'installs' | 'verified' | 'alpha' | 'recent';

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'installs', label: 'Most installed' },
  { value: 'verified', label: 'Verified first' },
  { value: 'alpha', label: 'Alphabetical' },
  { value: 'recent', label: 'Recently added' },
];

const SORT_VALUES = new Set<SortMode>(['installs', 'verified', 'alpha', 'recent']);

function parseSort(v: unknown): SortMode {
  if (typeof v === 'string' && (SORT_VALUES as Set<string>).has(v)) {
    return v as SortMode;
  }
  return 'installs';
}

/** Sort listings in-place friendly (non-mutating) per the chosen mode. */
function sortListings(
  listings: MarketplaceListing[],
  mode: SortMode,
): MarketplaceListing[] {
  const copy = [...listings];
  switch (mode) {
    case 'installs':
      return copy.sort((a, b) => b.installs - a.installs);
    case 'verified':
      return copy.sort((a, b) => {
        if (a.verified === b.verified) return b.installs - a.installs;
        return a.verified ? -1 : 1;
      });
    case 'alpha':
      return copy.sort((a, b) => a.display_name.localeCompare(b.display_name));
    case 'recent':
      // The mock store has no `created_at` on listings, so we fall back to id
      // ordering (seeded listings are appended in creation order; descending
      // id ≈ recently added).
      return copy.sort((a, b) => b.id.localeCompare(a.id));
  }
}

export function MarketplaceGrid({ onInstall }: MarketplaceGridProps) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });

  // URL-sync: read q + tags + verified + sort from search params.
  const urlQuery = typeof (search as Record<string, unknown>).q === 'string'
    ? ((search as Record<string, unknown>).q as string)
    : '';
  const urlTagsRaw = (search as Record<string, unknown>).tags;
  const urlTags: string[] = Array.isArray(urlTagsRaw)
    ? (urlTagsRaw.filter((t): t is string => typeof t === 'string'))
    : typeof urlTagsRaw === 'string' && urlTagsRaw.length > 0
      ? urlTagsRaw.split(',')
      : [];
  const urlVerifiedRaw = (search as Record<string, unknown>).verified;
  const urlVerified = urlVerifiedRaw === 'true' || urlVerifiedRaw === true;
  const urlSort = parseSort((search as Record<string, unknown>).sort);

  const [searchInput, setSearchInput] = useState(urlQuery);
  const [debouncedSearch] = useDebouncedValue(searchInput, 300);

  const handleSearchCommit = useCallback(
    (value: string) => {
      void navigate({
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          q: value || undefined,
        }),
        replace: true,
      } as unknown as Parameters<typeof navigate>[0]);
    },
    [navigate],
  );

  // Commit debounced search to URL — effect is the right shape here:
  // the URL is an external system that must sync with the debounced React
  // state (the lint rule permits setState/sync that targets external state).
  useEffect(() => {
    if (debouncedSearch !== urlQuery) handleSearchCommit(debouncedSearch);
  }, [debouncedSearch, urlQuery, handleSearchCommit]);

  const handleTagsChange = useCallback(
    (tags: string[]) => {
      void navigate({
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          tags: tags.length > 0 ? tags : undefined,
        }),
        replace: true,
      } as unknown as Parameters<typeof navigate>[0]);
    },
    [navigate],
  );

  const handleVerifiedChange = useCallback(
    (checked: boolean) => {
      void navigate({
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          verified: checked ? 'true' : undefined,
        }),
        replace: true,
      } as unknown as Parameters<typeof navigate>[0]);
    },
    [navigate],
  );

  const handleSortChange = useCallback(
    (mode: SortMode) => {
      void navigate({
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          sort: mode === 'installs' ? undefined : mode,
        }),
        replace: true,
      } as unknown as Parameters<typeof navigate>[0]);
    },
    [navigate],
  );

  // ── Data ────────────────────────────────────────────────────────────────────
  const baseFilter: MarketplaceFilter = { search: urlQuery, tags: urlTags };
  const baseListings = useMarketplaceListings(baseFilter);
  const allTags = useMarketplaceTags();

  // Category counts are derived from the FULL unfiltered set so the sidebar
  // reflects the catalog shape, not the current filter (important for
  // discoverability — users should see "no plugins match this tag" rather
  // than the tag vanishing).
  const allListings = useMarketplaceListings({ search: '', tags: [] });
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const l of allListings) {
      for (const t of l.tags) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    return counts;
  }, [allListings]);

  // Apply verified-only filter on top of base listings + apply sort.
  const listings = useMemo(() => {
    let out = baseListings;
    if (urlVerified) {
      out = out.filter((l) => l.verified);
    }
    return sortListings(out, urlSort);
  }, [baseListings, urlVerified, urlSort]);

  // ── Category sidebar handlers ────────────────────────────────────────────────
  const activeCategory = urlTags[0] ?? null; // primary category = first tag

  function handleCategorySelect(tag: string | null) {
    // Replace the tag filter entirely with this single category (simple model
    // for the sidebar; advanced filters can still use the MultiSelect).
    handleTagsChange(tag === null ? [] : [tag]);
  }

  return (
    <Grid>
      {/* ── Left sidebar: categories ───────────────────────────────────────── */}
      <Grid.Col span={{ base: 12, sm: 3 }}>
        <Card withBorder radius="md" p="sm">
          <Stack gap="xs">
            <Group gap="xs">
              <IconLayoutGrid size={14} />
              <Text size="sm" fw={600}>
                Categories
              </Text>
            </Group>
            <Divider />
            <NavLink
              label={
                <Group justify="space-between" w="100%">
                  <Text size="sm">All plugins</Text>
                  <Badge size="xs" variant="light" color="gray">
                    {allListings.length}
                  </Badge>
                </Group>
              }
              active={activeCategory === null}
              data-testid="category-all"
              onClick={() => {
                handleCategorySelect(null);
              }}
            />
            {allTags.map((tag) => (
              <NavLink
                key={tag}
                label={
                  <Group justify="space-between" w="100%">
                    <Text size="sm" ff="monospace">
                      {tag}
                    </Text>
                    <Badge
                      size="xs"
                      variant={activeCategory === tag ? 'filled' : 'light'}
                      color={activeCategory === tag ? 'blue' : 'gray'}
                    >
                      {categoryCounts[tag] ?? 0}
                    </Badge>
                  </Group>
                }
                active={activeCategory === tag}
                leftSection={<IconTags size={14} />}
                data-testid={`category-${tag}`}
                onClick={() => {
                  handleCategorySelect(tag);
                }}
              />
            ))}
          </Stack>
        </Card>
      </Grid.Col>

      {/* ── Main grid ───────────────────────────────────────────────────────── */}
      <Grid.Col span={{ base: 12, sm: 9 }}>
        <Stack gap="md">
          <Group gap="sm" align="flex-end" wrap="wrap">
            <TextInput
              placeholder="Search name, author, or slug…"
              leftSection={<IconSearch size={14} />}
              value={searchInput}
              onChange={(e) => {
                setSearchInput(e.currentTarget.value);
              }}
              style={{ flex: 1, minWidth: 220 }}
              aria-label="Search marketplace"
            />
            <Switch
              label="Verified publishers only"
              checked={urlVerified}
              onChange={(e) => {
                handleVerifiedChange(e.currentTarget.checked);
              }}
              data-testid="marketplace-verified-toggle"
              aria-label="Show verified publishers only"
            />
            <Select
              data={SORT_OPTIONS}
              value={urlSort}
              onChange={(value) => {
                if (value !== null) handleSortChange(parseSort(value));
              }}
              w={180}
              allowDeselect={false}
              aria-label="Sort marketplace"
              data-testid="marketplace-sort-select"
            />
          </Group>

          {/* Active-category chip row (quick-clear UX) */}
          {activeCategory !== null && (
            <Group gap={6}>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Category:
              </Text>
              <Badge
                size="sm"
                color="blue"
                variant="light"
                rightSection={
                  <Box
                    component="span"
                    style={{ cursor: 'pointer', paddingLeft: 4 }}
                    onClick={() => {
                      handleCategorySelect(null);
                    }}
                    aria-label={`Clear category ${activeCategory}`}
                    role="button"
                  >
                    ×
                  </Box>
                }
              >
                {activeCategory}
              </Badge>
            </Group>
          )}

          {listings.length === 0 ? (
            <EmptyState
              icon={IconShoppingBag}
              title="No plugins match"
              description="Try clearing filters or a different search term."
            />
          ) : (
            <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
              {listings.map((listing) => (
                <Card
                  key={listing.id}
                  withBorder
                  radius="md"
                  p="md"
                  data-testid={`marketplace-listing-${listing.slug}`}
                >
                  <Stack gap="xs" h="100%">
                    <Group
                      justify="space-between"
                      align="flex-start"
                      wrap="nowrap"
                    >
                      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                        <Group gap="xs" wrap="nowrap">
                          <Title order={5} style={{ wordBreak: 'break-word' }}>
                            {listing.display_name}
                          </Title>
                          {listing.verified && (
                            <Badge
                              size="xs"
                              color="green"
                              variant="light"
                              leftSection={<IconCircleCheck size={10} />}
                            >
                              verified
                            </Badge>
                          )}
                        </Group>
                        <Text size="xs" c="var(--mantine-color-gray-7)">
                          by {listing.author} · v{listing.version}
                        </Text>
                      </Stack>
                    </Group>

                    <Text size="sm" style={{ flex: 1 }} lineClamp={3}>
                      {listing.description}
                    </Text>

                    <Group gap={4}>
                      {listing.tags.map((tag) => (
                        <Badge
                          key={tag}
                          size="xs"
                          color="gray"
                          variant="outline"
                        >
                          {tag}
                        </Badge>
                      ))}
                    </Group>

                    <Group justify="space-between" align="center" mt="xs">
                      <Text size="xs" c="var(--mantine-color-gray-7)">
                        {listing.installs.toLocaleString()} installs
                      </Text>
                      <Button
                        size="xs"
                        leftSection={<IconDownload size={14} />}
                        onClick={() => {
                          onInstall(listing);
                        }}
                      >
                        Install
                      </Button>
                    </Group>
                  </Stack>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </Stack>
      </Grid.Col>
    </Grid>
  );
}
