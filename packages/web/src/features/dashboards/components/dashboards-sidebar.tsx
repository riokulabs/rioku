/**
 * <DashboardsSidebar> — secondary sidebar listing dashboards (settings-style).
 *
 * Mirrors the settings layout's sidebar: 220px panel with search, list, and
 * footer actions. Each item shows the dashboard name + a small mode badge
 * + a default star. Click an item to navigate to its viewer.
 */
import { useMemo, useRef, useState } from 'react';
import { Box, Button, Stack, Text, TextInput, NavLink, Tooltip, Badge, Group } from '@mantine/core';
import {
  IconLayoutDashboard,
  IconPlus,
  IconSearch,
  IconStar,
  IconUpload,
} from '@tabler/icons-react';
import type { Dashboard } from '@/api/resources';

interface DashboardsSidebarProps {
  dashboards: Dashboard[];
  activeDashboardId: string | null;
  onSelect: (dashboard: Dashboard) => void;
  onNew: () => void;
  onImport: () => void;
  canWrite: boolean;
  /** Render full-width on mobile and 220px-fixed on sm+. */
  isSmallScreen: boolean;
}

const MODE_COLORS: Record<Dashboard['mode'], string> = {
  metabase: 'blue',
  grafana: 'violet',
};

export function DashboardsSidebar({
  dashboards,
  activeDashboardId,
  onSelect,
  onNew,
  onImport,
  canWrite,
  isSmallScreen,
}: DashboardsSidebarProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return dashboards;
    return dashboards.filter((d) => {
      const nameMatch = d.name.toLowerCase().includes(q);
      const descMatch = d.description?.toLowerCase().includes(q) ?? false;
      return nameMatch || descMatch;
    });
  }, [dashboards, query]);

  return (
    <Box
      style={{
        width: isSmallScreen ? '100%' : 240,
        borderRight: isSmallScreen ? 'none' : '1px solid var(--mantine-color-default-border)',
        borderBottom: isSmallScreen ? '1px solid var(--mantine-color-default-border)' : 'none',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        height: isSmallScreen ? 'auto' : '100%',
      }}
      p="sm"
    >
      <Text
        size="xs"
        c="var(--mantine-color-gray-7)"
        tt="uppercase"
        fw={600}
        px="xs"
        pt="xs"
        pb="xs"
      >
        Dashboards
      </Text>

      <TextInput
        ref={inputRef}
        placeholder="Search dashboards…"
        size="xs"
        leftSection={<IconSearch size={14} />}
        value={query}
        onChange={(e) => {
          setQuery(e.currentTarget.value);
        }}
        aria-label="Search dashboards"
        mb="xs"
        data-testid="dashboards-sidebar-search"
      />

      <Box style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
        {filtered.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)" px="xs" py="sm">
            {query
              ? `No dashboards match "${query}"`
              : 'No dashboards yet. Create one to get started.'}
          </Text>
        ) : (
          <Stack gap={2}>
            {filtered.map((d) => (
              <NavLink
                key={d.id}
                label={
                  <Group gap={6} wrap="nowrap" align="center" justify="space-between">
                    <Text size="sm" truncate style={{ flex: 1, minWidth: 0 }}>
                      {d.name}
                    </Text>
                    <Group gap={4} wrap="nowrap">
                      {d.default && (
                        <Tooltip label="Tenant default" withArrow>
                          <IconStar
                            size={12}
                            style={{ color: 'var(--mantine-color-green-6)', flexShrink: 0 }}
                          />
                        </Tooltip>
                      )}
                      <Badge
                        size="xs"
                        variant="light"
                        color={MODE_COLORS[d.mode]}
                        styles={{ root: { textTransform: 'lowercase' } }}
                      >
                        {d.mode}
                      </Badge>
                    </Group>
                  </Group>
                }
                leftSection={<IconLayoutDashboard size={16} />}
                active={activeDashboardId === d.id}
                onClick={() => {
                  onSelect(d);
                }}
                data-testid={`dashboards-sidebar-item-${d.id}`}
              />
            ))}
          </Stack>
        )}
      </Box>

      <Stack gap="xs" mt="sm">
        <Tooltip
          label="You don't have permission to create dashboards"
          disabled={canWrite}
          withArrow
        >
          <span>
            <Button
              fullWidth
              size="xs"
              leftSection={<IconPlus size={14} />}
              disabled={!canWrite}
              onClick={onNew}
              data-testid="dashboards-sidebar-new"
            >
              New dashboard
            </Button>
          </span>
        </Tooltip>
        <Tooltip
          label="You don't have permission to import dashboards"
          disabled={canWrite}
          withArrow
        >
          <span>
            <Button
              fullWidth
              size="xs"
              variant="default"
              leftSection={<IconUpload size={14} />}
              disabled={!canWrite}
              onClick={onImport}
              data-testid="dashboards-sidebar-import"
            >
              Import
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}
