/**
 * <ProfilePreferences> — theme picker, locale picker, timezone Select (creatable),
 * reduced motion Switch, notification toggles.
 *
 * Theme picker uses `useActiveTheme` + BUILTIN_THEMES (same approach as the
 * sidebar footer — no `useMantineColorScheme` since this app uses a custom
 * theme registry, not Mantine's built-in color scheme manager).
 *
 * Task 8a.2
 */
import { useCallback } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Fieldset,
  Group,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState } from 'react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useActiveTheme } from '@/hooks/use-active-theme';
import { BUILTIN_THEMES } from '@/theme';
import { BUILT_IN_CATEGORIES } from '@/features/notifications/schemas';
import { updatePreferences } from '../api';
import { preferencesSchema, type PreferencesValues } from '../schemas';
import type { User } from '@/api/resources/types';

// ─── Category label map ───────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<string, string> = {
  system: 'System',
  security: 'Security',
  audit: 'Audit',
};

// ─── Timezone list ────────────────────────────────────────────────────────────

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'America/Toronto',
  'America/Vancouver',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Amsterdam',
  'Europe/Dublin',
  'Europe/Moscow',
  'Europe/Stockholm',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Pacific/Auckland',
  'Pacific/Honolulu',
];

const TIMEZONE_DATA = COMMON_TIMEZONES.map((tz) => ({ value: tz, label: tz }));

const LOCALE_DATA = [
  { value: 'en', label: 'English' },
  { value: 'ar', label: 'Arabic (عربي)' },
];

// ─── Component ────────────────────────────────────────────────────────────────

interface ProfilePreferencesProps {
  user: User;
}

export function ProfilePreferences({ user }: ProfilePreferencesProps) {
  const canUpdate = usePermission('user:update-own');
  const [activeThemeName, setActiveThemeName] = useActiveTheme();
  const [loading, setLoading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const themeData = BUILTIN_THEMES.map((t) => ({
    value: t.name,
    label: t.displayName,
  }));

  const form = useForm<PreferencesValues>({
    initialValues: {
      theme: activeThemeName,
      locale: user.locale === 'ar' ? 'ar' : 'en',
      timezone: user.timezone,
      reduced_motion: user.reduced_motion,
      notification_email: user.notification_preferences.email,
      notification_in_app: user.notification_preferences.in_app,
      categories_muted: user.notification_preferences.categories_muted,
    },
    validate: schemaResolver(preferencesSchema, { sync: true }),
  });

  const handleSubmit = useCallback(
    async (values: PreferencesValues) => {
      setLoading(true);
      setSaveError(null);
      try {
        // Theme is stored in localStorage (not in the user model).
        setActiveThemeName(values.theme);

        await updatePreferences(user.id, {
          locale: values.locale,
          timezone: values.timezone,
          reduced_motion: values.reduced_motion,
          notification_email: values.notification_email,
          notification_in_app: values.notification_in_app,
          categories_muted: values.categories_muted,
        });

        notify.success('Preferences saved');
        form.resetDirty(values);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to save preferences';
        setSaveError(msg);
      } finally {
        setLoading(false);
      }
    },
    [user.id, setActiveThemeName, form],
  );

  return (
    <form
      onSubmit={form.onSubmit((v) => {
        void handleSubmit(v);
      })}
      data-testid="profile-preferences-form"
    >
      <Stack gap="md">
        {saveError && (
          <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">
            {saveError}
          </Alert>
        )}

        {/* Theme */}
        <Select
          label="Theme"
          data={themeData}
          disabled={!canUpdate}
          data-testid="profile-theme-select"
          {...form.getInputProps('theme')}
        />

        {/* Locale */}
        <Select
          label="Language"
          data={LOCALE_DATA}
          disabled={!canUpdate}
          data-testid="profile-locale-select"
          {...form.getInputProps('locale')}
        />

        {/* Timezone — searchable Select with common IANA zones */}
        <Select
          label="Timezone"
          data={TIMEZONE_DATA}
          searchable
          allowDeselect={false}
          disabled={!canUpdate}
          data-testid="profile-timezone-select"
          {...form.getInputProps('timezone')}
        />

        {/* Reduced motion */}
        <Fieldset legend="Accessibility">
          <Switch
            label="Reduce motion"
            description="Suppresses animations and transitions throughout the UI."
            disabled={!canUpdate}
            data-testid="profile-reduced-motion"
            checked={form.values.reduced_motion}
            onChange={(e) => {
              form.setFieldValue('reduced_motion', e.currentTarget.checked);
            }}
          />
        </Fieldset>

        {/* Notification toggles */}
        <Fieldset legend="Notifications">
          <Stack gap="xs">
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Choose which channels deliver notifications to you.
            </Text>
            <Switch
              label="Email notifications"
              disabled={!canUpdate}
              data-testid="profile-notification-email"
              checked={form.values.notification_email}
              onChange={(e) => {
                form.setFieldValue('notification_email', e.currentTarget.checked);
              }}
            />
            <Switch
              label="In-app notifications"
              disabled={!canUpdate}
              data-testid="profile-notification-in-app"
              checked={form.values.notification_in_app}
              onChange={(e) => {
                form.setFieldValue('notification_in_app', e.currentTarget.checked);
              }}
            />

            {/* Mute categories */}
            <Checkbox.Group
              label="Mute categories"
              description="Selected categories will not generate notifications."
              value={form.values.categories_muted}
              onChange={(val) => {
                form.setFieldValue('categories_muted', val);
              }}
              data-testid="profile-mute-categories"
            >
              <Group gap="sm" mt="xs">
                {BUILT_IN_CATEGORIES.map((cat) => (
                  <Checkbox
                    key={cat}
                    value={cat}
                    label={CATEGORY_LABELS[cat] ?? cat}
                    disabled={!canUpdate}
                    data-testid={`profile-mute-category-${cat}`}
                  />
                ))}
              </Group>
            </Checkbox.Group>
          </Stack>
        </Fieldset>

        <Group justify="flex-end">
          <Tooltip
            label="You don't have permission to update your profile"
            disabled={canUpdate}
            withArrow
          >
            <span>
              <Button
                type="submit"
                loading={loading}
                disabled={!canUpdate}
                data-testid="profile-preferences-save"
              >
                Save preferences
              </Button>
            </span>
          </Tooltip>
        </Group>
      </Stack>
    </form>
  );
}
