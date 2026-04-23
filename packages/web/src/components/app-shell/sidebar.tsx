/**
 * <Sidebar> — two-pane navigation: thin icon rail + section panel.
 *
 * Layout:
 *   ┌────┬──────────────┐
 *   │    │ Section      │
 *   │ R  │ nav items    │
 *   │ a  │              │
 *   │ i  │              │
 *   │ l  │              │
 *   └────┴──────────────┘
 *
 * The rail is always 60px wide and stays visible on desktop even when
 * "collapsed" — the collapse toggle only hides the panel. On mobile the
 * whole sidebar (rail + panel) slides in via AppShell's mobile burger.
 *
 * The rail hosts: the 7 top-level sections, a collapse/expand toggle, and
 * the tenant + user avatars (which open the existing menus). The panel
 * hosts the active section's children (e.g. AI → Providers / Agents /
 * Tools / …). Sections with no children leave the panel blank when
 * active, which is the right behavior for leaf pages like Sites.
 */
import { Box, Group, NavLink, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { IconChevronLeft, IconChevronRight, IconPlug } from '@tabler/icons-react';
import { Link, useLocation, useParams } from '@tanstack/react-router';
import type { ComponentType } from 'react';
import { useSidebarEntries } from '@/hooks/use-sidebar-entries';
import { NAV_SECTIONS, activeSectionFor, type NavSection } from './nav-tree';
import { SidebarFooter } from './sidebar-footer';

interface SidebarProps {
  /** Closes mobile drawer after navigation — no-op on desktop. */
  onNavLinkClick?: () => void;
  /** Desktop only: hide the section panel, keep the rail. */
  collapsed?: boolean;
  /** Toggles `collapsed`. Renders the rail's collapse chevron. */
  onToggleCollapsed?: () => void;
}

export function Sidebar({ onNavLinkClick, collapsed = false, onToggleCollapsed }: SidebarProps) {
  const location = useLocation();
  const { tenant: tenantSlug = 'acme' } = useParams({ strict: false });
  const pluginEntries = useSidebarEntries('plugins');

  // Derive the tenant-prefixed suffix so nav-tree's match logic is
  // tenant-agnostic ("ai/providers" rather than "/t/acme/ai/providers").
  const pathSuffix = extractSuffix(location.pathname, tenantSlug);
  const active = activeSectionFor(pathSuffix);

  return (
    <Group gap={0} align="stretch" h="100%" wrap="nowrap">
      <Rail
        activeSectionId={active.id}
        tenantSlug={tenantSlug}
        collapsed={collapsed}
        {...(onToggleCollapsed !== undefined && { onToggleCollapsed })}
        {...(onNavLinkClick !== undefined && { onNavLinkClick })}
      />
      {!collapsed && (
        <SectionPanel
          section={active}
          tenantSlug={tenantSlug}
          pathname={location.pathname}
          pluginEntries={pluginEntries}
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
        width: 60,
        flexShrink: 0,
        borderRight: '1px solid var(--mantine-color-default-border)',
      }}
      align="center"
    >
      {/* Section icons */}
      <Stack gap={4} align="center" style={{ flex: 1, width: '100%' }}>
        {NAV_SECTIONS.map((section) => (
          <RailSectionIcon
            key={section.id}
            section={section}
            tenantSlug={tenantSlug}
            active={section.id === activeSectionId}
            {...(onNavLinkClick !== undefined && { onClick: onNavLinkClick })}
          />
        ))}
      </Stack>

      {/* Collapse/expand toggle */}
      {onToggleCollapsed !== undefined && (
        <Tooltip
          label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          position="right"
          withArrow
        >
          <UnstyledButton
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={onToggleCollapsed}
            data-testid="sidebar-collapse-toggle"
            style={{
              width: 40,
              height: 32,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--mantine-color-dimmed)',
            }}
          >
            {collapsed ? <IconChevronRight size={16} /> : <IconChevronLeft size={16} />}
          </UnstyledButton>
        </Tooltip>
      )}

      {/* Tenant + user avatars — SidebarFooter is tight in its rail rendering */}
      <SidebarFooter collapsed />
    </Stack>
  );
}

interface RailSectionIconProps {
  section: NavSection;
  tenantSlug: string;
  active: boolean;
  onClick?: () => void;
}

function RailSectionIcon({ section, tenantSlug, active, onClick }: RailSectionIconProps) {
  const to =
    section.defaultRoute !== undefined
      ? `/t/${tenantSlug}/${section.defaultRoute}`
      : `/t/${tenantSlug}/${section.matchPaths[0] ?? section.id}`;
  const Icon = section.icon;
  return (
    <Tooltip label={section.label} position="right" withArrow openDelay={200}>
      <UnstyledButton
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
        component={Link as any}
        to={to}
        aria-label={section.label}
        aria-current={active ? 'page' : undefined}
        data-testid={`rail-section-${section.id}`}
        {...(onClick !== undefined && { onClick })}
        style={{
          width: 40,
          height: 40,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
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
              left: -10,
              top: 8,
              bottom: 8,
              width: 3,
              borderRadius: 2,
              background: 'var(--mantine-primary-color-filled)',
            }}
          />
        )}
        <Icon size={18} />
      </UnstyledButton>
    </Tooltip>
  );
}

// ─── Section panel ────────────────────────────────────────────────────────────

interface SectionPanelProps {
  section: NavSection;
  tenantSlug: string;
  pathname: string;
  pluginEntries: ReturnType<typeof useSidebarEntries>;
  onNavLinkClick?: () => void;
}

function SectionPanel({
  section,
  tenantSlug,
  pathname,
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
        {section.children !== undefined && section.children.length > 0 && (
          <Stack gap={2} px={6}>
            {section.children.map((item) => {
              const to = `/t/${tenantSlug}/${item.suffix}`;
              const itemPath = `/t/${tenantSlug}/${item.suffix}`;
              const active = pathname === itemPath || pathname.startsWith(`${itemPath}/`);
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.suffix}
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
                const Icon = (entry.icon as ComponentType<{ size?: number }> | undefined) ?? IconPlug;
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
