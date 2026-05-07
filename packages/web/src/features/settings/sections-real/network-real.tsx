/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API NetworkSection — stage-2 wiring.
 *
 * Reads via `useGetSettingsNetwork`, replaces via `usePutSettingsNetwork`.
 * After PUT lands, the daemon invokes `caddy.Reload()` (verified server-side
 * by `TestSettingsNetworkPutTriggersCaddyReload` in
 * `packages/daemon/internal/gateway/settings_configs_routes_test.go`).
 *
 * Plan 07 — Task 4.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Loader,
  NumberInput,
  SimpleGrid,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import {
  useGetSettingsNetwork,
  usePutSettingsNetwork,
} from '@/api/generated/settings/settings';
import { ValidationError } from '@/api/errors';
import { notify } from '@/hooks/use-notify';
import { unwrap } from './_unwrap';

interface NetworkRealSectionProps {
  tenant: string;
}

export function NetworkRealSection({ tenant }: NetworkRealSectionProps) {
  const query = useGetSettingsNetwork(tenant);
  const put = usePutSettingsNetwork();

  const [listenAddresses, setListenAddresses] = useState(':443,:80');
  const [http3, setHttp3] = useState(true);
  const [readTimeout, setReadTimeout] = useState(60);
  const [writeTimeout, setWriteTimeout] = useState(60);
  const [idleTimeout, setIdleTimeout] = useState(120);
  const [touched, setTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const cfg = unwrap<{
    listenAddresses?: string[];
    http3Enabled?: boolean;
    readTimeoutSeconds?: number;
    writeTimeoutSeconds?: number;
    idleTimeoutSeconds?: number;
  }>(query.data);
  useEffect(() => {
    if (!cfg || touched) return;
    if (Array.isArray(cfg.listenAddresses)) {
      setListenAddresses(cfg.listenAddresses.join(','));
    }
    setHttp3(cfg.http3Enabled ?? true);
    setReadTimeout(cfg.readTimeoutSeconds ?? 60);
    setWriteTimeout(cfg.writeTimeoutSeconds ?? 60);
    setIdleTimeout(cfg.idleTimeoutSeconds ?? 120);
  }, [cfg, touched]);

  if (query.isLoading)
    return (
      <Stack align="center" py="xl" data-testid="network-real-loading">
        <Loader />
      </Stack>
    );
  if (query.isError)
    return (
      <Alert color="red" data-testid="network-real-error">
        Failed to load network config: {(query.error as Error).message}
      </Alert>
    );

  async function onSave() {
    setFieldErrors({});
    const addrs = listenAddresses
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    try {
      await put.mutateAsync({
        tenant,
        data: {
          listenAddresses: addrs,
          http3Enabled: http3,
          readTimeoutSeconds: readTimeout,
          writeTimeoutSeconds: writeTimeout,
          idleTimeoutSeconds: idleTimeout,
        },
      });
      notify.success(
        'Network config saved',
        'Caddy reloaded with new configuration.',
      );
      setTouched(false);
      await query.refetch();
    } catch (err) {
      if (err instanceof ValidationError && err.fields) {
        const flat: Record<string, string> = {};
        for (const [k, v] of Object.entries(err.fields)) {
          flat[k] = Array.isArray(v) ? v.join(', ') : String(v);
        }
        setFieldErrors(flat);
      } else {
        notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
      }
    }
  }

  return (
    <Stack gap="lg" data-testid="network-real-section">
      <Title order={5}>Listen addresses</Title>
      <TextInput
        label="Listen addresses (comma-separated)"
        value={listenAddresses}
        onChange={(e) => {
          setListenAddresses(e.currentTarget.value);
          setTouched(true);
        }}
        error={fieldErrors.listenAddresses}
        data-testid="network-real-listen"
      />
      <Switch
        label="Enable HTTP/3 (QUIC)"
        checked={http3}
        onChange={(e) => {
          setHttp3(e.currentTarget.checked);
          setTouched(true);
        }}
        data-testid="network-real-http3"
      />
      <Title order={5}>Upstream timeouts</Title>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="sm">
        <NumberInput
          label="Read (s)"
          value={readTimeout}
          onChange={(v) => {
            setReadTimeout(typeof v === 'number' ? v : 60);
            setTouched(true);
          }}
          min={1}
          max={3600}
          data-testid="network-real-read-timeout"
        />
        <NumberInput
          label="Write (s)"
          value={writeTimeout}
          onChange={(v) => {
            setWriteTimeout(typeof v === 'number' ? v : 60);
            setTouched(true);
          }}
          min={1}
          max={3600}
          data-testid="network-real-write-timeout"
        />
        <NumberInput
          label="Idle (s)"
          value={idleTimeout}
          onChange={(v) => {
            setIdleTimeout(typeof v === 'number' ? v : 120);
            setTouched(true);
          }}
          min={1}
          max={3600}
          data-testid="network-real-idle-timeout"
        />
      </SimpleGrid>
      <Group justify="flex-end">
        <Button
          onClick={() => {
            void onSave();
          }}
          loading={put.isPending}
          disabled={!touched}
          data-testid="network-real-save"
        >
          Save
        </Button>
      </Group>
      <Text size="xs" c="dimmed">
        Saving triggers a Caddy reload server-side; new listen addresses take
        effect immediately. Audit emitted server-side.
      </Text>
    </Stack>
  );
}
