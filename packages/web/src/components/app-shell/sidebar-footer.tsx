import { Box, Stack, Menu, MenuSub, Avatar, Group, Text } from '@mantine/core';
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
import { useTenant } from '@/hooks/use-tenant';
import { useActiveTheme } from '@/hooks/use-active-theme';
import { BUILTIN_THEMES } from '@/theme';

const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'العربية' },
];

export function SidebarFooter() {
  const { slug } = useTenant();
  const tenantLabel = slug ?? 'acme';
  const tenantInitial = tenantLabel.slice(0, 1).toUpperCase();
  const [activeThemeName, setActiveThemeName] = useActiveTheme();
  const { i18n } = useTranslation();

  return (
    <Stack
      gap="xs"
      p="xs"
      style={{ borderTop: '1px solid var(--mantine-color-default-border)' }}
    >
      <Menu>
        <Menu.Target>
          <Box
            role="button"
            style={{
              cursor: 'pointer',
              background: 'var(--mantine-color-green-light)',
              color: 'var(--mantine-color-green-filled)',
              padding: '4px 8px',
              borderRadius: 4,
            }}
          >
            <Group justify="space-between" gap="xs">
              <Group gap="xs">
                <Avatar color="green" size="sm" radius="sm">
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
          <Menu.Item>acme</Menu.Item>
          <Menu.Item>beta</Menu.Item>
          <Menu.Item>gamma</Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <Menu>
        <Menu.Target>
          <Box
            role="button"
            style={{ cursor: 'pointer', padding: '4px 8px', borderRadius: 4 }}
          >
            <Group justify="space-between" gap="xs">
              <Group gap="xs">
                <Avatar color="blue" size="sm" radius="xl">
                  D
                </Avatar>
                <Box>
                  <Text size="sm" fw={600}>
                    derrick
                  </Text>
                  <Text size="xs" c="dimmed">
                    derrick@rioku.dev
                  </Text>
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
              {BUILTIN_THEMES.map((t) => (
                <MenuSub.Item
                  key={t.name}
                  leftSection={
                    activeThemeName === t.name ? (
                      <IconCheck size={14} />
                    ) : (
                      <Box style={{ width: 14 }} />
                    )
                  }
                  onClick={() => { setActiveThemeName(t.name); }}
                >
                  {t.displayName}
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
                  onClick={() => { void i18n.changeLanguage(lang.code); }}
                >
                  {lang.label}
                </MenuSub.Item>
              ))}
            </MenuSub.Dropdown>
          </Menu.Sub>

          <Menu.Divider />

          <Menu.Item leftSection={<IconLogout size={14} />} color="red">
            Sign out
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Stack>
  );
}
