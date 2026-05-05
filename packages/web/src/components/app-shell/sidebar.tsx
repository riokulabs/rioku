/**
 * <Sidebar> — main nav (rail) + optional sub-menu panel.
 *
 * Layout:
 *   ┌────┬──────────────┐       ┌──────────┬──────────────┐
 *   │ R  │ Sub menu     │       │ icon Lbl │ Sub menu     │
 *   │ a  │              │  or   │ icon Lbl │              │
 *   │ i  │              │       │ icon Lbl │              │
 *   │ l  │              │       │  …       │              │
 *   └────┴──────────────┘       └──────────┴──────────────┘
 *      collapsed rail               expanded rail
 *
 * The main nav (rail) has two modes:
 *   - collapsed: icons only (60px)
 *   - expanded:  icons + labels (190px)
 *
 * The toggle chevron lives in the rail itself (bottom, above the footer).
 * The sub-menu panel renders to the right whenever the active section has
 * children. Sections without children don't render a panel — the rail
 * fills the sidebar on its own.
 */
import { Box, Group, NavLink, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconPlug } from '@tabler/icons-react';
import { Link, useLocation, useParams } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { useSidebarEntries } from '@/hooks/use-sidebar-entries';
import { getNavEntriesForGroup, type NavGroup } from './nav-registry';
import { NAV_SECTIONS, activeSectionFor, type NavSection } from './nav-tree';
import { SidebarFooter } from './sidebar-footer';
import { AnalyticsNavPanel } from './analytics-nav-panel';

interface SidebarProps {
  /** Closes mobile drawer after navigation — no-op on desktop. */
  onNavLinkClick?: () => void;
  /** Desktop only: when true, the rail shows icons only; when false, icons + labels. */
  collapsed?: boolean;
  /** Toggles `collapsed`. Renders the rail's collapse chevron. */
  onToggleCollapsed?: () => void;
}

export function Sidebar({ onNavLinkClick, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const location = useLocation();
  const { tenant: tenantSlug = 'acme' } = useParams({ strict: false });
  const pluginEntries = useSidebarEntries('plugins');

  const pathSuffix = extractSuffix(location.pathname, tenantSlug);
  const active = activeSectionFor(pathSuffix);

  const pluginEntriesForPanel = active.id === 'system' ? pluginEntries : [];
  const registryChildren = getNavEntriesForGroup(active.id as NavGroup);
  // Analytics renders its own dynamic panel (lists dashboards), so it always
  // has a panel even though it has no static registry children.
  const hasChildren =
    active.id === 'analytics' || registryChildren.length > 0 || pluginEntriesForPanel.length > 0;

  return (
    <Group gap={0} align="stretch" h="100%" wrap="nowrap">
      <Rail
        activeSectionId={active.id}
        tenantSlug={tenantSlug}
        collapsed={collapsed}
        {...(onToggleCollapsed !== undefined && { onToggleCollapsed })}
        {...(onNavLinkClick !== undefined && { onNavLinkClick })}
      />
      {hasChildren && active.id === 'analytics' && (
        <AnalyticsNavPanel
          tenantSlug={tenantSlug}
          {...(onNavLinkClick !== undefined && { onNavLinkClick })}
        />
      )}
      {hasChildren && active.id !== 'analytics' && (
        <SectionPanel
          section={active}
          tenantSlug={tenantSlug}
          pathname={location.pathname}
          registryChildren={registryChildren}
          pluginEntries={pluginEntriesForPanel}
          {...(onNavLinkClick !== undefined && { onNavLinkClick })}
        />
      )}
    </Group>
  );
}

function extractSuffix(pathname: string, tenantSlug: string): string {
  const prefix = `/t/${tenantSlug}/`;
  if (pathname.startsWith(prefix)) return pathname.slice(prefix.length);
  // Strip leading slash for consistency with matchPaths ("dashboard", not "/dashboard").
  return pathname.replace(/^\/+/, '');
}

// ─── Rail ─────────────────────────────────────────────────────────────────────

interface RailProps {
  activeSectionId: string;
  tenantSlug: string;
  collapsed: boolean;
  onToggleCollapsed?: () => void;
  onNavLinkClick?: () => void;
}

function Rail({
  activeSectionId,
  tenantSlug,
  collapsed,
  onToggleCollapsed,
  onNavLinkClick,
}: RailProps) {
  return (
    <Stack
      gap={4}
      py="xs"
      style={{
        width: collapsed ? 60 : 190,
        flexShrink: 0,
        borderRight: '1px solid var(--mantine-color-default-border)',
      }}
      align="stretch"
    >
      {/* Section entries */}
      <Stack gap={4} style={{ flex: 1 }}>
        {NAV_SECTIONS.map((section) => (
          <RailSectionEntry
            key={section.id}
            section={section}
            tenantSlug={tenantSlug}
            active={section.id === activeSectionId}
            collapsed={collapsed}
            {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
          />
        ))}
      </Stack>

      {/* Collapse/expand toggle — lives in the main nav per design */}
      {onToggleCollapsed !== undefined && (
        <Tooltip
          label={collapsed ? 'Expand main menu' : 'Collapse main menu'}
          position="right"
          withArrow
          disabled={!collapsed}
        >
          <UnstyledButton
            aria-label={collapsed ? 'Expand main menu' : 'Collapse main menu'}
            onClick={onToggleCollapsed}
            data-testid="sidebar-collapse-toggle"
            style={{
              height: 32,
              margin: collapsed ? '0 auto' : '0 8px',
              width: collapsed ? 40 : 'auto',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: collapsed ? 'center' : 'flex-end',
              padding: collapsed ? 0 : '0 8px',
              color: 'var(--mantine-color-dimmed)',
            }}
          >
            {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
          </UnstyledButton>
        </Tooltip>
      )}

      {/* Tenant + user avatars — footer matches the rail's current mode */}
      <SidebarFooter collapsed={collapsed} />
    </Stack>
  );
}

interface RailSectionEntryProps {
  section: NavSection;
  tenantSlug: string;
  active: boolean;
  collapsed: boolean;
  onClick?: () => void;
}

function RailSectionEntry({
  section,
  tenantSlug,
  active,
  collapsed,
  onClick,
}: RailSectionEntryProps) {
  const to =
    section.defaultRoute !== undefined
      ? `/t/${tenantSlug}/${section.defaultRoute}`
      : `/t/${tenantSlug}/${section.matchPaths[0] ?? section.id}`;
  const Icon = section.icon;

  const button = (
    <UnstyledButton
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      component={Link as any}
      to={to}
      aria-label={section.label}
      aria-current={active ? 'page' : undefined}
      data-testid={`rail-section-${section.id}`}
      {...(onClick !== undefined && { onClick })}
      style={{
        height: 40,
        margin: collapsed ? '0 auto' : '0 8px',
        width: collapsed ? 40 : 'auto',
        borderRadius: 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 10,
        padding: collapsed ? 0 : '0 10px',
        position: 'relative',
        background: active ? 'var(--mantine-color-default-hover)' : 'transparent',
        color: active ? 'var(--mantine-primary-color-filled)' : 'var(--mantine-color-text)',
      }}
    >
      {/* Active-state rail indicator: 2px accent bar along the left edge */}
      {active && (
        <Box
          aria-hidden
          style={{
            position: 'absolute',
            left: collapsed ? -10 : -8,
            top: 8,
            bottom: 8,
            width: 3,
            borderRadius: 2,
            background: 'var(--mantine-primary-color-filled)',
          }}
        />
      )}
      <Icon size={18} />
      {!collapsed && (
        <Text size="sm" fw={active ? 600 : 500} style={{ lineHeight: 1 }}>
          {section.label}
        </Text>
      )}
    </UnstyledButton>
  );

  // Tooltips are only useful in the collapsed state (no labels visible).
  return collapsed ? (
    <Tooltip label={section.label} position="right" withArrow openDelay={200}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

// ─── Section panel ────────────────────────────────────────────────────────────

interface SectionPanelProps {
  section: NavSection;
  tenantSlug: string;
  pathname: string;
  registryChildren: ReturnType<typeof getNavEntriesForGroup>;
  pluginEntries: ReturnType<typeof useSidebarEntries>;
  onNavLinkClick?: () => void;
}

function SectionPanel({
  section,
  tenantSlug,
  pathname,
  registryChildren,
  pluginEntries,
  onNavLinkClick,
}: SectionPanelProps) {
  return (
    <Stack gap={0} style={{ flex: 1, minWidth: 0 }}>
      <Box p="sm" pb={6}>
        <Text size="xs" tt="uppercase" fw={700} c="dimmed" style={{ letterSpacing: '0.06em' }}>
          {section.label}
        </Text>
      </Box>
      <Box style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {registryChildren.length > 0 && (
          <Stack gap={2} px={6}>
            {registryChildren.map((item) => {
              const to = `/t/${tenantSlug}/${item.suffix}`;
              const itemPath = `/t/${tenantSlug}/${item.suffix}`;
              const active = pathname === itemPath || pathname.startsWith(`${itemPath}/`);
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.id}
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                  component={Link as any}
                  to={to}
                  label={item.label}
                  leftSection={<Icon size={16} />}
                  active={active}
                  {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
                />
              );
            })}
          </Stack>
        )}

        {/* Plugin-contributed entries only render under the System section so
            they don't flood every panel. Revisit when we have per-section
            plugin anchors. */}
        {section.id === 'system' && pluginEntries.length > 0 && (
          <Box mt="sm" px={6}>
            <Text size="xs" tt="uppercase" fw={600} c="dimmed" px="xs" py={4}>
              Plugins
            </Text>
            <Stack gap={2}>
              {pluginEntries.map((entry) => {
                const Icon =
                  (entry.icon as ComponentType<{ size?: number }> | undefined) ?? IconPlug;
                return (
                  <NavLink
                    key={entry.id}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
                    component={Link as any}
                    to={entry.path}
                    label={entry.label}
                    leftSection={<Icon size={16} />}
                    active={pathname.startsWith(entry.path)}
                    {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
                  />
                );
              })}
            </Stack>
          </Box>
        )}
      </Box>
    </Stack>
  );
}
