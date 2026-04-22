import { useState } from 'react';
import { logout } from '@/features/auth/api';
import { Box, Stack, Menu, MenuSub, Avatar, Group, Text, Modal, Button } from '@mantine/core';
import {
  IconChevronDown,
  IconChevronRight,
  IconLogout,
  IconSettings,
  IconMessageCircle,
  IconCheck,
  IconPalette,
  IconLanguage,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useDisclosure } from '@mantine/hooks';
import { useNavigate } from '@tanstack/react-router';
import { useTenant, detectTenantMode } from '@/hooks/use-tenant';
import { useActiveTheme } from '@/hooks/use-active-theme';
import { useSession } from '@/hooks/use-session';
import { useMockStore } from '@/api/mock-store';
import { BUILTIN_THEMES } from '@/theme';
import { usePluginThemes } from '@/hooks/use-plugin-themes';
import type { Tenant } from '@/api/resources/types';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

export function SidebarFooter() {
  const { slug } = useTenant();
  const { currentUserId, currentTenantId } = useSession();
  const navigate = useNavigate();
  const [activeThemeName, setActiveThemeName] = useActiveTheme();
  const pluginThemes = usePluginThemes();
  const allThemes = [...BUILTIN_THEMES, ...pluginThemes];
  const { i18n } = useTranslation();

  // Subdomain-mode: track which tenant the user wants to switch to
  const [switchTarget, setSwitchTarget] = useState<Tenant | null>(null);
  const [subdomainConfirmOpen, { open: openSubdomainConfirm, close: closeSubdomainConfirm }] =
    useDisclosure(false);

  // Get memberships + tenants for the current user
  const allMemberships = useMockStore((s) => s.memberships);
  const allTenants = useMockStore((s) => s.tenants);
  const allUsers = useMockStore((s) => s.users);
  const activeImpersonationId = useMockStore((s) => s.activeImpersonationId);

  // Derive the tenants the current user belongs to, sorted by name
  const userTenants = Object.values(allMemberships)
    .filter((m) => m.user_id === currentUserId && m.state === 'active')
    .map((m) => allTenants[m.tenant_id])
    .filter((t): t is NonNullable<typeof t> => t != null)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Current tenant for display
  const currentTenant = currentTenantId ? allTenants[currentTenantId] : null;
  const tenantLabel = currentTenant?.slug ?? slug ?? 'acme';
  const tenantInitial = tenantLabel.slice(0, 1).toUpperCase();

  // Current user for display
  const currentUser = currentUserId ? allUsers[currentUserId] : null;
  const userDisplayName = currentUser?.name ?? 'User';
  const userEmail = currentUser?.email ?? '';
  const userInitial = userDisplayName.slice(0, 1).toUpperCase();

  // Amber highlight when impersonating
  const isImpersonating = activeImpersonationId !== null;

  const tenantMode = detectTenantMode();

  function handleTenantSwitch(target: Tenant) {
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
    if (switchTarget) {
      // In stage-1: cookie-clear is a no-op; just navigate
      void navigate({ to: '/t/$tenant/dashboard', params: { tenant: switchTarget.slug } });
    }
    closeSubdomainConfirm();
    setSwitchTarget(null);
  }

  return (
    <Stack gap="xs" p="xs" style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}>
      {/* Tenant switcher */}
      <Menu>
        <Menu.Target>
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
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Switch tenant</Menu.Label>
          {userTenants.length > 0 ? (
            userTenants.map((t) => (
              <Menu.Item
                key={t.id}
                leftSection={
                  t.id === currentTenantId ? <IconCheck size={14} /> : <Box style={{ width: 14 }} />
                }
                onClick={() => {
                  handleTenantSwitch(t);
                }}
                data-testid={`tenant-option-${t.slug}`}
              >
                {t.slug}
              </Menu.Item>
            ))
          ) : (
            // Fallback when no currentUserId (e.g. not yet authenticated) —
            // show all tenants from the store
            Object.values(allTenants)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((t) => (
                <Menu.Item
                  key={t.id}
                  onClick={() => {
                    handleTenantSwitch(t);
                  }}
                  data-testid={`tenant-option-${t.slug}`}
                >
                  {t.slug}
                </Menu.Item>
              ))
          )}
        </Menu.Dropdown>
      </Menu>

      {/* User menu */}
      <Menu>
        <Menu.Target>
          <Box role="button" style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}>
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
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item leftSection={<IconSettings size={14} />}>Profile</Menu.Item>
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
          Switching to <strong>{switchTarget?.name ?? ''}</strong> will sign you out of{' '}
          <strong>{currentTenant?.name ?? tenantLabel}</strong>. Continue?
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
