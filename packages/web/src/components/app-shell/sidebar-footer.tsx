import { useState } from 'react';
import { logout } from '@/features/auth/api';
import {
  Box,
  Stack,
  Menu,
  MenuSub,
  Avatar,
  Group,
  Text,
  Modal,
  Button,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconLogout,
  IconSettings,
  IconMessageCircle,
  IconCheck,
  IconPalette,
  IconLanguage,
  IconUser,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate } from '@tanstack/react-router';
import { useTenant, detectTenantMode } from '@/hooks/use-tenant';
import { useActiveTheme } from '@/hooks/use-active-theme';
import { useSession } from '@/hooks/use-session';
import { useCurrentUser } from '@/features/auth/use-current-user';
import { useListAdminTenants } from '@/api/generated/admin/admin';
import { useImpersonationSession } from '@/features/security/impersonation/use-impersonation-session';
import { BUILTIN_THEMES } from '@/theme';
import { usePluginThemes } from '@/hooks/use-plugin-themes';
import type { AdminTenant } from '@/api/generated/schemas';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

interface SidebarFooterProps {
  /**
   * Rail mode — render tenant + user as bare avatar buttons stacked
   * vertically, each acting as its own menu target. The existing Menu
   * dropdowns render fine from an avatar trigger.
   */
  collapsed?: boolean;
}

export function SidebarFooter({ collapsed = false }: SidebarFooterProps = {}) {
  const { slug } = useTenant();
  const { currentUserId, currentTenantId } = useSession();
  const navigate = useNavigate();
  const [activeThemeName, setActiveThemeName] = useActiveTheme();
  const pluginThemes = usePluginThemes();
  const allThemes = [...BUILTIN_THEMES, ...pluginThemes];
  const { i18n } = useTranslation();

  // Subdomain-mode: track which tenant the user wants to switch to
  const [switchTarget, setSwitchTarget] = useState<AdminTenant | null>(null);
  const [subdomainConfirmOpen, { open: openSubdomainConfirm, close: closeSubdomainConfirm }] =
    useDisclosure(false);

  // Tenant directory comes from the daemon admin endpoint. Non-super-admin
  // users get a 403 — the query falls back to an empty list and the
  // switcher quietly disables.
  const tenantsQuery = useListAdminTenants();
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
  const allTenants: AdminTenant[] = (tenantsQuery.data?.data?.items ?? []).filter(
    (t): t is AdminTenant => t.id !== undefined && t.slug !== undefined,
  );
  const me = useCurrentUser().data ?? null;
  const impersonationSession = useImpersonationSession();

  // Sorted tenant list for the switcher.
  const userTenants = [...allTenants].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  // Current tenant for display — match by slug from the route since
  // `currentTenantId` at the session layer is the slug.
  const currentTenant =
    allTenants.find((t) => t.slug === currentTenantId || t.id === currentTenantId) ?? null;
  const tenantLabel = currentTenant?.slug ?? slug ?? 'acme';
  const tenantInitial = tenantLabel.slice(0, 1).toUpperCase();

  // Current user for display
  const userDisplayName = me?.displayName ?? me?.username ?? 'User';
  const userEmail = me?.email ?? '';
  const userInitial = userDisplayName.slice(0, 1).toUpperCase();
  void currentUserId;

  // Amber highlight when impersonating
  const isImpersonating = impersonationSession !== null;

  const tenantMode = detectTenantMode();

  function handleTenantSwitch(target: AdminTenant) {
    if (target.slug === undefined) return;
    if (tenantMode === 'subdomain') {
      // Subdomain mode: warn user about session boundary
      setSwitchTarget(target);
      openSubdomainConfirm();
    } else {
      // Path-prefix mode: navigate directly (no confirm)
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: target.slug } });
    }
  }

  function confirmSubdomainSwitch() {
    if (switchTarget?.slug) {
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: switchTarget.slug } });
    }
    closeSubdomainConfirm();
    setSwitchTarget(null);
  }

  return (
    <Stack
      gap="xs"
      p={collapsed ? 6 : 'xs'}
      style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
      align={collapsed ? 'center' : 'stretch'}
    >
      {/* Tenant switcher */}
      <Menu position={collapsed ? 'right-end' : 'bottom'} withinPortal>
        <Menu.Target>
          {collapsed ? (
            <Tooltip label={`Tenant: ${tenantLabel}`} position="right" withArrow>
              <UnstyledButton
                aria-label={`Switch tenant (${tenantLabel})`}
                style={{ borderRadius: 8, padding: 2 }}
              >
                <Avatar color={isImpersonating ? 'yellow' : 'green'} size="md" radius="sm">
                  {tenantInitial}
                </Avatar>
              </UnstyledButton>
            </Tooltip>
          ) : (
            <Box
              role="button"
              style={{
                cursor: 'pointer',
                background: isImpersonating
                  ? 'var(--mantine-color-yellow-light)'
                  : 'var(--mantine-color-green-light)',
                color: isImpersonating
                  ? 'var(--mantine-color-yellow-filled)'
                  : 'var(--mantine-color-green-filled)',
                padding: '4px 8px',
                borderRadius: 4,
              }}
            >
              <Group justify="space-between" gap="xs">
                <Group gap="xs">
                  <Avatar color={isImpersonating ? 'yellow' : 'green'} size="sm" radius="sm">
                    {tenantInitial}
                  </Avatar>
                  <Text size="sm" fw={600}>
                    {tenantLabel}
                  </Text>
                </Group>
                <IconChevronDown size={14} />
              </Group>
            </Box>
          )}
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Switch tenant</Menu.Label>
          {userTenants.length > 0 ? (
            userTenants.map((t) => (
              <Menu.Item
                key={t.id}
                leftSection={
                  t.slug === currentTenantId || t.id === currentTenantId ? (
                    <IconCheck size={14} />
                  ) : (
                    <Box style={{ width: 14 }} />
                  )
                }
                onClick={() => {
                  handleTenantSwitch(t);
                }}
                data-testid={`tenant-option-${t.slug ?? t.id ?? 'unknown'}`}
              >
                {t.slug ?? t.id}
              </Menu.Item>
            ))
          ) : (
            <Menu.Item disabled>No tenants available</Menu.Item>
          )}
        </Menu.Dropdown>
      </Menu>

      {/* User menu */}
      <Menu position={collapsed ? 'right-end' : 'bottom'} withinPortal>
        <Menu.Target>
          {collapsed ? (
            <Tooltip label={userDisplayName} position="right" withArrow>
              <UnstyledButton
                aria-label={`User menu (${userDisplayName})`}
                data-testid="user-menu-trigger"
                style={{ borderRadius: 999, padding: 2 }}
              >
                <Avatar color="blue" size="md" radius="xl">
                  {userInitial}
                </Avatar>
              </UnstyledButton>
            </Tooltip>
          ) : (
            <Box
              role="button"
              aria-label={`User menu (${userDisplayName})`}
              data-testid="user-menu-trigger"
              style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
            >
              <Group justify="space-between" gap="xs">
                <Group gap="xs">
                  <Avatar color="blue" size="sm" radius="xl">
                    {userInitial}
                  </Avatar>
                  <Box>
                    <Text size="sm" fw={600}>
                      {userDisplayName}
                    </Text>
                    <Text size="xs">{userEmail}</Text>
                  </Box>
                </Group>
                <IconChevronDown size={14} />
              </Group>
            </Box>
          )}
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconUser size={14} />}
            onClick={() => {
              void navigate({
                to: '/t/$tenant/settings',
                params: { tenant: slug ?? 'acme' },
                search: { section: 'profile' },
              });
            }}
          >
            Profile
          </Menu.Item>
          <Menu.Item
            leftSection={<IconSettings size={14} />}
            onClick={() => {
              void navigate({
                to: '/t/$tenant/settings',
                params: { tenant: slug ?? 'acme' },
                search: { section: undefined },
              });
            }}
            data-testid="user-menu-settings"
          >
            Settings
          </Menu.Item>
          <Menu.Item
            leftSection={<IconMessageCircle size={14} />}
            component="a"
            href="https://github.com/riokulabs/rioku/issues/new"
            target="_blank"
            rel="noreferrer"
          >
            Report feedback
          </Menu.Item>

          <Menu.Divider />

          {/* Theme submenu */}
          <Menu.Sub>
            <MenuSub.Target>
              <Menu.Item
                leftSection={<IconPalette size={14} />}
                rightSection={<IconChevronRight size={12} />}
              >
                Theme
              </Menu.Item>
            </MenuSub.Target>
            <MenuSub.Dropdown>
              {allThemes.map((t) => (
                <MenuSub.Item
                  key={t.name}
                  leftSection={
                    activeThemeName === t.name ? (
                      <IconCheck size={14} />
                    ) : (
                      <Box style={{ width: 14 }} />
                    )
                  }
                  onClick={() => {
                    setActiveThemeName(t.name);
                  }}
                >
                  {t.displayName}
                  {t.source === 'plugin' && (
                    <Text component="span" size="xs" c="var(--mantine-color-gray-7)" ml={4}>
                      (plugin)
                    </Text>
                  )}
                </MenuSub.Item>
              ))}
            </MenuSub.Dropdown>
          </Menu.Sub>

          {/* Language submenu */}
          <Menu.Sub>
            <MenuSub.Target>
              <Menu.Item
                leftSection={<IconLanguage size={14} />}
                rightSection={<IconChevronRight size={12} />}
              >
                Language
              </Menu.Item>
            </MenuSub.Target>
            <MenuSub.Dropdown>
              {LANGUAGES.map((lang) => (
                <MenuSub.Item
                  key={lang.code}
                  data-testid={`language-option-${lang.code}`}
                  leftSection={
                    i18n.language === lang.code ? (
                      <IconCheck size={14} />
                    ) : (
                      <Box style={{ width: 14 }} />
                    )
                  }
                  onClick={() => {
                    void i18n.changeLanguage(lang.code);
                  }}
                >
                  {lang.label}
                </MenuSub.Item>
              ))}
            </MenuSub.Dropdown>
          </Menu.Sub>

          <Menu.Divider />

          <Menu.Item
            leftSection={<IconLogout size={14} />}
            color="red"
            data-testid="sign-out-btn"
            onClick={() => {
              void logout().then(() => {
                void navigate({ to: '/login' });
              });
            }}
          >
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      {/* Subdomain-mode confirm dialog */}
      <Modal
        opened={subdomainConfirmOpen}
        onClose={closeSubdomainConfirm}
        title="Switch tenant"
        size="sm"
      >
        <Text size="sm" mb="md">
          Switching to <strong>{switchTarget?.name ?? switchTarget?.slug ?? ''}</strong> will sign
          you out of <strong>{currentTenant?.name ?? tenantLabel}</strong>. Continue?
        </Text>
        <Group justify="flex-end" gap="xs">
          <Button variant="default" onClick={closeSubdomainConfirm}>
            Cancel
          </Button>
          <Button onClick={confirmSubdomainSwitch} data-testid="confirm-subdomain-switch">
            Switch
          </Button>
        </Group>
      </Modal>
    </Stack>
  );
}
