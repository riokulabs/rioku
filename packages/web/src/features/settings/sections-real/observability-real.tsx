/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API Observability section — stage-2 wiring.
 *
 * Three side-by-side cards: metrics, logs, traces. Each PUTs independently.
 * Live preview tail uses SSE against `/observability/logs/tail` if the
 * endpoint is available; falls back to a static notice otherwise.
 *
 * Plan 07 — Task 7.
 */
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  NumberInput,
  Select,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  useGetSettingsObservabilityLogs,
  useGetSettingsObservabilityMetrics,
  useGetSettingsObservabilityTraces,
  usePutSettingsObservabilityLogs,
  usePutSettingsObservabilityMetrics,
  usePutSettingsObservabilityTraces,
} from '@/api/generated/settings/settings';
import { notify } from '@/hooks/use-notify';
import { unwrap } from './_unwrap';

interface ObservabilityRealSectionProps {
  tenant: string;
}

export function ObservabilityRealSection({ tenant }: ObservabilityRealSectionProps) {
  return (
    <Stack gap="xl" data-testid="observability-real-section">
      <Title order={4}>Observability</Title>
      <SimpleGrid cols={{ base: 1, lg: 3 }} spacing="md">
        <MetricsCard tenant={tenant} />
        <LogsCard tenant={tenant} />
        <TracesCard tenant={tenant} />
      </SimpleGrid>
      <LogsTailPreview tenant={tenant} />
    </Stack>
  );
}

function MetricsCard({ tenant }: { tenant: string }) {
  const q = useGetSettingsObservabilityMetrics(tenant);
  const put = usePutSettingsObservabilityMetrics();
  const [scrape, setScrape] = useState('');
  const [auth, setAuth] = useState<'none' | 'basic' | 'bearer'>('none');
  const [retention, setRetention] = useState(30);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const d = unwrap<{ scrapeEndpoint?: string; scrapeAuth?: string; retentionDays?: number }>(
      q.data,
    );
    if (!d || dirty) return;
    setScrape(d.scrapeEndpoint ?? '');
    setAuth((d.scrapeAuth as 'none' | 'basic' | 'bearer' | undefined) ?? 'none');
    setRetention(d.retentionDays ?? 30);
  }, [q.data, dirty]);

  async function save() {
    try {
      await put.mutateAsync({
        tenant,
        data: { scrapeEndpoint: scrape, scrapeAuth: auth, retentionDays: retention },
      });
      notify.success('Metrics config saved');
      setDirty(false);
      await q.refetch();
    } catch (err) {
      notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  if (q.isLoading)
    return (
      <Card withBorder>
        <Loader size="sm" />
      </Card>
    );

  return (
    <Card withBorder data-testid="metrics-card">
      <Stack gap="sm">
        <Title order={6}>Metrics</Title>
        <TextInput
          label="Scrape endpoint"
          value={scrape}
          onChange={(e) => {
            setScrape(e.currentTarget.value);
            setDirty(true);
          }}
          data-testid="metrics-scrape"
        />
        <Select
          label="Auth"
          value={auth}
          onChange={(v) => {
            setAuth((v) ?? 'none');
            setDirty(true);
          }}
          data={['none', 'basic', 'bearer']}
          data-testid="metrics-auth"
        />
        <NumberInput
          label="Retention (days)"
          value={retention}
          min={1}
          max={3650}
          onChange={(v) => {
            setRetention(typeof v === 'number' ? v : 30);
            setDirty(true);
          }}
          data-testid="metrics-retention"
        />
        <Button
          size="xs"
          loading={put.isPending}
          disabled={!dirty}
          onClick={() => {
            void save();
          }}
          data-testid="metrics-save"
        >
          Save
        </Button>
      </Stack>
    </Card>
  );
}

function LogsCard({ tenant }: { tenant: string }) {
  const q = useGetSettingsObservabilityLogs(tenant);
  const put = usePutSettingsObservabilityLogs();
  const [level, setLevel] = useState<'debug' | 'info' | 'warn' | 'error'>('info');
  const [format, setFormat] = useState<'json' | 'text'>('json');
  const [rotation, setRotation] = useState(7);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const d = unwrap<{ level?: string; format?: string; rotationDays?: number }>(q.data);
    if (!d || dirty) return;
    setLevel((d.level as 'debug' | 'info' | 'warn' | 'error' | undefined) ?? 'info');
    setFormat((d.format as 'json' | 'text' | undefined) ?? 'json');
    setRotation(d.rotationDays ?? 7);
  }, [q.data, dirty]);

  async function save() {
    try {
      await put.mutateAsync({
        tenant,
        data: { level, format, rotationDays: rotation },
      });
      notify.success('Logs config saved');
      setDirty(false);
      await q.refetch();
    } catch (err) {
      notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  if (q.isLoading)
    return (
      <Card withBorder>
        <Loader size="sm" />
      </Card>
    );

  return (
    <Card withBorder data-testid="logs-card">
      <Stack gap="sm">
        <Title order={6}>Logs</Title>
        <Select
          label="Level"
          value={level}
          onChange={(v) => {
            setLevel((v) ?? 'info');
            setDirty(true);
          }}
          data={['debug', 'info', 'warn', 'error']}
          data-testid="logs-level"
        />
        <Select
          label="Format"
          value={format}
          onChange={(v) => {
            setFormat((v) ?? 'json');
            setDirty(true);
          }}
          data={['json', 'text']}
          data-testid="logs-format"
        />
        <NumberInput
          label="Rotation (days)"
          value={rotation}
          min={1}
          max={365}
          onChange={(v) => {
            setRotation(typeof v === 'number' ? v : 7);
            setDirty(true);
          }}
          data-testid="logs-rotation"
        />
        <Button
          size="xs"
          loading={put.isPending}
          disabled={!dirty}
          onClick={() => {
            void save();
          }}
          data-testid="logs-save"
        >
          Save
        </Button>
      </Stack>
    </Card>
  );
}

function TracesCard({ tenant }: { tenant: string }) {
  const q = useGetSettingsObservabilityTraces(tenant);
  const put = usePutSettingsObservabilityTraces();
  const [otlp, setOtlp] = useState('');
  const [sample, setSample] = useState(0.1);
  const [retention, setRetention] = useState(7);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const d = unwrap<{ otlpEndpoint?: string; sampleRate?: number; retentionDays?: number }>(
      q.data,
    );
    if (!d || dirty) return;
    setOtlp(d.otlpEndpoint ?? '');
    setSample(d.sampleRate ?? 0.1);
    setRetention(d.retentionDays ?? 7);
  }, [q.data, dirty]);

  async function save() {
    try {
      await put.mutateAsync({
        tenant,
        data: { otlpEndpoint: otlp, sampleRate: sample, retentionDays: retention },
      });
      notify.success('Traces config saved');
      setDirty(false);
      await q.refetch();
    } catch (err) {
      notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  if (q.isLoading)
    return (
      <Card withBorder>
        <Loader size="sm" />
      </Card>
    );

  return (
    <Card withBorder data-testid="traces-card">
      <Stack gap="sm">
        <Title order={6}>Traces</Title>
        <TextInput
          label="OTLP endpoint"
          value={otlp}
          onChange={(e) => {
            setOtlp(e.currentTarget.value);
            setDirty(true);
          }}
          data-testid="traces-otlp"
        />
        <NumberInput
          label="Sample rate (0..1)"
          value={sample}
          min={0}
          max={1}
          step={0.01}
          decimalScale={2}
          onChange={(v) => {
            setSample(typeof v === 'number' ? v : 0.1);
            setDirty(true);
          }}
          data-testid="traces-sample"
        />
        <NumberInput
          label="Retention (days)"
          value={retention}
          min={1}
          max={365}
          onChange={(v) => {
            setRetention(typeof v === 'number' ? v : 7);
            setDirty(true);
          }}
          data-testid="traces-retention"
        />
        <Button
          size="xs"
          loading={put.isPending}
          disabled={!dirty}
          onClick={() => {
            void save();
          }}
          data-testid="traces-save"
        >
          Save
        </Button>
      </Stack>
    </Card>
  );
}

function LogsTailPreview({ tenant }: { tenant: string }) {
  const [lines, setLines] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  function start() {
    if (streaming) return;
    setError(null);
    setLines([]);
    try {
      const url = `/api/v1/t/${encodeURIComponent(tenant)}/observability/logs/tail`;
      const src = new EventSource(url, { withCredentials: true });
      src.onmessage = (ev) => {
        const line = String(ev.data);
        setLines((prev) => {
          const next: string[] = [...prev, line];
          return next.length > 200 ? next.slice(-200) : next;
        });
      };
      src.onerror = () => {
        setError('Stream disconnected. Daemon endpoint may not be available.');
        src.close();
        setStreaming(false);
      };
      sourceRef.current = src;
      setStreaming(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to open stream');
    }
  }

  function stop() {
    sourceRef.current?.close();
    sourceRef.current = null;
    setStreaming(false);
  }

  useEffect(() => () => {
    sourceRef.current?.close();
  }, []);

  return (
    <Card withBorder data-testid="logs-tail-card">
      <Stack gap="sm">
        <Group justify="space-between">
          <Title order={6}>Live log tail (preview)</Title>
          <Group gap="xs">
            {streaming ? (
              <Badge color="green" variant="dot" data-testid="logs-tail-streaming">
                Streaming
              </Badge>
            ) : (
              <Badge color="gray" variant="outline" data-testid="logs-tail-idle">
                Idle
              </Badge>
            )}
            {streaming ? (
              <Button size="xs" variant="default" onClick={stop} data-testid="logs-tail-stop">
                Stop
              </Button>
            ) : (
              <Button size="xs" onClick={start} data-testid="logs-tail-start">
                Start tail
              </Button>
            )}
          </Group>
        </Group>
        {error && (
          <Alert color="orange" variant="light" data-testid="logs-tail-error">
            {error}
          </Alert>
        )}
        <Code block style={{ maxHeight: 200, overflow: 'auto' }} data-testid="logs-tail-output">
          {lines.length === 0 ? (
            <Text size="xs" c="dimmed">
              Click &ldquo;Start tail&rdquo; to begin streaming the daemon log buffer over SSE.
            </Text>
          ) : (
            lines.join('\n')
          )}
        </Code>
      </Stack>
    </Card>
  );
}
