/**
 * <PluginDisabledTooltip> — explains why a plugin is unsupported on
 * the current daemon.
 *
 * Two cases are surfaced:
 *
 *   1. The plugin's `kind` (declared in its manifest) requires a
 *      capability the current daemon lacks (e.g. sideload, remote
 *      build, GPU). The tooltip references `useDaemonCapabilities`.
 *   2. The plugin's `min_daemon_version` exceeds the current
 *      daemon's reported version.
 *
 * For Plan 09 stage-2 the only daemon capability we track is
 * `sideloadEnabled`; this component renders a single "sideload not
 * available" path. As more flags are added the message body extends.
 */
import type { ReactNode } from 'react';
import { Group, Text, ThemeIcon, Tooltip } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useDaemonCapabilities } from '../../use-daemon-capabilities';

export interface PluginDisabledTooltipProps {
  /** Plugin manifest kind, e.g. "sideload" | "marketplace" | "build-service". */
  kind?: string;
  /** Wraps an indicator icon next to the supplied children. */
  children?: ReactNode;
}

export function PluginDisabledTooltip({ kind = '', children }: PluginDisabledTooltipProps) {
  const caps = useDaemonCapabilities();

  let reason: string | null = null;
  if (kind === 'sideload' && !caps.sideloadEnabled) {
    reason =
      'This plugin requires sideload, which is disabled on this daemon. Set RIOKU_SIDELOAD_ENABLED=1 to enable.';
  }

  if (reason === null) return <>{children}</>;

  return (
    <Tooltip label={reason} multiline w={280} withArrow>
      <Group gap={6} align="center" aria-label="plugin-disabled-tooltip">
        <ThemeIcon size="xs" variant="light" color="yellow" aria-hidden="true">
          <IconAlertTriangle size={12} />
        </ThemeIcon>
        <Text size="xs" c="yellow.8">
          Unsupported
        </Text>
        {children}
      </Group>
    </Tooltip>
  );
}
