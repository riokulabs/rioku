/**
 * <MarketplaceGrid> — browsable catalog of marketplace listings.
 *
 * Filter bar: text search (name/author/slug) + tag MultiSelect.
 * Search + tags URL-sync via useSearch/useNavigate (per spec §13.2a).
 * Each card has an Install button that bubbles up to the parent route.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  Group,
  MultiSelect,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import {
  IconCircleCheck,
  IconDownload,
  IconSearch,
  IconShoppingBag,
} from '@tabler/icons-react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { EmptyState } from '@/components/empty-state';
import { useMarketplaceListings, useMarketplaceTags } from '../api';
import type { MarketplaceFilter, MarketplaceListing } from '../types';

interface MarketplaceGridProps {
  onInstall: (listing: MarketplaceListing) => void;
}

export function MarketplaceGrid({ onInstall }: MarketplaceGridProps) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false });

  // URL-sync: read q + tags from search params.
  const urlQuery = typeof (search as Record<string, unknown>).q === 'string'
    ? ((search as Record<string, unknown>).q as string)
    : '';
  const urlTagsRaw = (search as Record<string, unknown>).tags;
  const urlTags: string[] = Array.isArray(urlTagsRaw)
    ? (urlTagsRaw.filter((t): t is string => typeof t === 'string'))
    : typeof urlTagsRaw === 'string' && urlTagsRaw.length > 0
      ? urlTagsRaw.split(',')
      : [];

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

  const filter: MarketplaceFilter = { search: urlQuery, tags: urlTags };
  const listings = useMarketplaceListings(filter);
  const allTags = useMarketplaceTags();
  const tagOptions = allTags.map((t) => ({ value: t, label: t }));

  return (
    <Stack gap="md">
      <Group gap="sm" align="flex-end">
        <TextInput
          placeholder="Search name, author, or slug…"
          leftSection={<IconSearch size={14} />}
          value={searchInput}
          onChange={(e) => {
            setSearchInput(e.currentTarget.value);
          }}
          style={{ flex: 1 }}
          aria-label="Search marketplace"
        />
        <MultiSelect
          data={tagOptions}
          value={urlTags}
          onChange={handleTagsChange}
          placeholder="Filter tags"
          searchable
          clearable
          w={260}
          aria-label="Filter by tag"
        />
      </Group>

      {listings.length === 0 ? (
        <EmptyState
          icon={IconShoppingBag}
          title="No plugins match"
          description="Try clearing filters or a different search term."
        />
      ) : (
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="md">
          {listings.map((listing) => (
            <Card key={listing.id} withBorder radius="md" p="md">
              <Stack gap="xs" h="100%">
                <Group justify="space-between" align="flex-start" wrap="nowrap">
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
  );
}
