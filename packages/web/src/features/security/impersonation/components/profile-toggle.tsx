/**
 * <ProfileToggle> — minimal vs full impersonation profile selector.
 *
 * Minimal: super-admin's full permissions in that tenant — appropriate when
 * you need the same access the admin role grants to perform diagnostic or
 * corrective actions.
 *
 * Full: read-only by default with explicit opt-in to write/destructive tiers —
 * appropriate for careful audit or investigation that should avoid accidental
 * mutations.
 *
 * spec §8.2 / Task 1d.75
 */
import { SegmentedControl, Tooltip, Group, Text, Stack } from '@mantine/core';
import { IconEye, IconShield } from '@tabler/icons-react';
import type { ImpersonationProfile } from '../types';

interface ProfileToggleProps {
  value: ImpersonationProfile;
  onChange: (value: ImpersonationProfile) => void;
}

const TOOLTIPS: Record<ImpersonationProfile, string> = {
  minimal:
    "Super-admin's full permissions in that tenant. Use when you need write access to diagnose or fix an issue.",
  full: 'Read-only by default. Explicit opt-in to write/destructive tiers. Safer for audit and investigation.',
};

export function ProfileToggle({ value, onChange }: ProfileToggleProps) {
  return (
    <Stack gap={6}>
      <Text size="sm" fw={500}>
        Impersonation profile
      </Text>
      <Group gap="xs" wrap="nowrap">
        <Tooltip label={TOOLTIPS[value]} multiline w={280} withArrow>
          <SegmentedControl
            value={value}
            onChange={(v: ImpersonationProfile) => {
              onChange(v);
            }}
            data={[
              {
                value: 'minimal',
                label: (
                  <Group gap={4} wrap="nowrap">
                    <IconShield size={14} />
                    <span>Minimal</span>
                  </Group>
                ),
              },
              {
                value: 'full',
                label: (
                  <Group gap={4} wrap="nowrap">
                    <IconEye size={14} />
                    <span>Full (read-only)</span>
                  </Group>
                ),
              },
            ]}
          />
        </Tooltip>
      </Group>
      <Text size="xs" c="dimmed">
        {TOOLTIPS[value]}
      </Text>
    </Stack>
  );
}
