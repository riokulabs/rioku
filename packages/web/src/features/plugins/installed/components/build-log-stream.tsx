/**
 * <PluginBuildLogStream> — live build log viewer for plugins in the
 * `building` state.
 *
 * Wire protocol: `GET /api/v1/t/{tenant}/plugins/{id}/build-log/stream`
 * is a server-sent-events stream emitting `log` events whose `data`
 * payload is a single line of build output. The stream terminates
 * with a `complete` event when the build finishes.
 *
 * The component caps the rolling buffer at 500 lines so a long-running
 * build doesn't blow up React's reconciliation cost. Older lines are
 * dropped from the head.
 */
import { useEffect, useRef, useState } from 'react';
import { Box, Code, Group, Loader, Stack, Text } from '@mantine/core';

const MAX_LINES = 500;

const SSE_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '/api/v1';

export interface PluginBuildLogStreamProps {
  /** Plugin id whose build log should be streamed. */
  pluginId: string;
  /** Tenant slug for the SSE URL. Required. */
  tenantId: string;
  /**
   * Reflects the daemon-reported plugin state. We only subscribe when
   * the plugin is `building`; once the row reports `stable` or
   * `failed`, the stream is no longer needed.
   */
  buildState: 'stable' | 'building' | 'failed';
}

export function PluginBuildLogStream({
  pluginId,
  tenantId,
  buildState,
}: PluginBuildLogStreamProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const tailRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (buildState !== 'building') return;
    if (!pluginId || !tenantId) return;

    const url = `${SSE_BASE}/t/${tenantId}/plugins/${pluginId}/build-log/stream`;
    const es = new EventSource(url, { withCredentials: true });

    es.addEventListener('log', (ev: MessageEvent) => {
      const raw = typeof ev.data === 'string' ? ev.data : '';
      setLines((prev) => {
        const next = [...prev, raw];
        if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES);
        return next;
      });
    });
    es.addEventListener('complete', () => {
      setDone(true);
      es.close();
    });
    es.addEventListener('error', () => {
      // EventSource auto-reconnects; we surface a one-time hint via
      // the dimmed footer below by setting `done` only when the
      // server explicitly closes via `complete`.
    });
    return () => {
      es.close();
    };
  }, [pluginId, tenantId, buildState]);

  // Auto-scroll to the tail on new lines.
  useEffect(() => {
    tailRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' });
  }, [lines.length]);

  if (buildState !== 'building' && lines.length === 0) return null;

  return (
    <Stack gap="xs" aria-label="plugin-build-log-stream">
      <Group gap="xs" align="center">
        {!done && buildState === 'building' && <Loader size="xs" />}
        <Text size="sm" fw={500}>
          {done ? 'Build complete' : 'Build in progress…'}
        </Text>
      </Group>
      <Box
        component="pre"
        style={{
          maxHeight: 320,
          overflow: 'auto',
          background: 'var(--mantine-color-dark-9)',
          color: 'var(--mantine-color-gray-2)',
          padding: 12,
          borderRadius: 4,
          fontSize: 12,
          margin: 0,
        }}
      >
        {lines.length === 0 ? (
          <Text size="xs" c="dimmed">
            Waiting for output…
          </Text>
        ) : (
          lines.map((l, i) => (
            <Code key={i} block style={{ background: 'transparent', color: 'inherit', padding: 0 }}>
              {l}
            </Code>
          ))
        )}
        <div ref={tailRef} />
      </Box>
    </Stack>
  );
}
