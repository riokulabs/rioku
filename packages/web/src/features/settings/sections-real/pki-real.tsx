/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API PKI section — stage-2 wiring.
 *
 * Reads via `useGetSettingsPKI`, replaces via `usePutSettingsPKI`.
 * Surface:
 *   - CA chain config (PEM textarea)
 *   - Enrollment endpoint URL
 *   - Enrollment token TTL
 *   - Per-node certificate validity
 *   - Key algorithm dropdown
 *   - Revoked-cert list (from `/settings/pki/revocations` GET; client-only
 *     stub when daemon endpoint not present)
 *
 * Plan 07 — Task 6.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  NumberInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import {
  useGetSettingsPKI,
  usePutSettingsPKI,
} from '@/api/generated/settings/settings';
import type { SettingsPKIKeyAlgorithm } from '@/api/generated/schemas/settingsPKIKeyAlgorithm';
import { customFetch } from '@/api/mutator';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from './_unwrap';

interface PkiRealSectionProps {
  tenant: string;
}

interface RevocationEntry {
  id: string;
  subject: string;
  reason: string;
  revoked_at: string;
}

const KEY_ALGOS: { value: SettingsPKIKeyAlgorithm; label: string }[] = [
  { value: 'ed25519', label: 'Ed25519 (recommended)' },
  { value: 'ecdsa-p256', label: 'ECDSA P-256' },
  { value: 'rsa-2048', label: 'RSA 2048' },
  { value: 'rsa-4096', label: 'RSA 4096' },
];

export function PkiRealSection({ tenant }: PkiRealSectionProps) {
  const q = useGetSettingsPKI(tenant);
  const put = usePutSettingsPKI();
  const canWrite = usePermission('pki:write');

  const [caChainPem, setCaChainPem] = useState('');
  const [enrollEndpoint, setEnrollEndpoint] = useState('');
  const [enrollTtl, setEnrollTtl] = useState(3600);
  const [nodeValidity, setNodeValidity] = useState(86400);
  const [keyAlgo, setKeyAlgo] = useState<SettingsPKIKeyAlgorithm>('ed25519');
  const [dirty, setDirty] = useState(false);
  const [pemError, setPemError] = useState<string | null>(null);

  useEffect(() => {
    const d = unwrap<{
      caChainPem?: string;
      enrollmentEndpoint?: string;
      enrollmentTokenTtlSeconds?: number;
      nodeValiditySeconds?: number;
      keyAlgorithm?: string;
    }>(q.data);
    if (!d || dirty) return;
    setCaChainPem(d.caChainPem ?? '');
    setEnrollEndpoint(d.enrollmentEndpoint ?? '');
    setEnrollTtl(d.enrollmentTokenTtlSeconds ?? 3600);
    setNodeValidity(d.nodeValiditySeconds ?? 86400);
    setKeyAlgo((d.keyAlgorithm as SettingsPKIKeyAlgorithm | undefined) ?? 'ed25519');
  }, [q.data, dirty]);

  const revocations = useQuery({
    queryKey: ['pki', 'revocations', tenant],
    queryFn: async ({ signal }) => {
      try {
        return await customFetch<{ items: RevocationEntry[] }>({
          url: `/t/${encodeURIComponent(tenant)}/settings/pki/revocations`,
          method: 'GET',
          signal,
        });
      } catch {
        // Endpoint may not be present yet; surface empty list.
        return { items: [] };
      }
    },
    retry: false,
  });

  if (q.isLoading)
    return (
      <Stack align="center" py="xl" data-testid="pki-real-loading">
        <Loader />
      </Stack>
    );
  if (q.isError)
    return (
      <Alert color="red" data-testid="pki-real-error">
        Failed to load PKI config: {(q.error as Error).message}
      </Alert>
    );

  function validatePem(pem: string): string | null {
    if (pem.trim().length === 0) return null;
    if (!pem.includes('-----BEGIN CERTIFICATE-----')) {
      return 'CA chain PEM must contain at least one CERTIFICATE block.';
    }
    return null;
  }

  async function save() {
    const err = validatePem(caChainPem);
    if (err) {
      setPemError(err);
      return;
    }
    setPemError(null);
    try {
      await put.mutateAsync({
        tenant,
        data: {
          caChainPem,
          enrollmentEndpoint: enrollEndpoint,
          enrollmentTokenTtlSeconds: enrollTtl,
          nodeValiditySeconds: nodeValidity,
          keyAlgorithm: keyAlgo,
        },
      });
      notify.success('PKI configuration saved');
      setDirty(false);
      await q.refetch();
    } catch (e) {
      notify.error('Save failed', e instanceof Error ? e.message : 'Unknown');
    }
  }

  const revoked = revocations.data?.items ?? [];

  return (
    <Stack gap="lg" data-testid="pki-real-section">
      <Title order={4}>PKI</Title>
      {!canWrite && (
        <Alert color="yellow" icon={<IconAlertCircle size={14} />} data-testid="pki-real-readonly">
          Read-only — <code>pki:write</code> required to save.
        </Alert>
      )}

      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>CA chain</Title>
          <Textarea
            label="Root CA PEM"
            value={caChainPem}
            onChange={(e) => {
              setCaChainPem(e.currentTarget.value);
              setDirty(true);
              setPemError(null);
            }}
            minRows={6}
            placeholder="-----BEGIN CERTIFICATE-----..."
            error={pemError}
            data-testid="pki-real-ca-pem"
          />
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>Enrollment</Title>
          <TextInput
            label="Enrollment endpoint"
            value={enrollEndpoint}
            onChange={(e) => {
              setEnrollEndpoint(e.currentTarget.value);
              setDirty(true);
            }}
            placeholder="https://pki.example.com/enroll"
            data-testid="pki-real-enroll-endpoint"
          />
          <NumberInput
            label="Enrollment token TTL (s)"
            value={enrollTtl}
            min={60}
            onChange={(v) => {
              setEnrollTtl(typeof v === 'number' ? v : 3600);
              setDirty(true);
            }}
            data-testid="pki-real-token-ttl"
          />
          <NumberInput
            label="Node certificate validity (s)"
            value={nodeValidity}
            min={300}
            onChange={(v) => {
              setNodeValidity(typeof v === 'number' ? v : 86400);
              setDirty(true);
            }}
            data-testid="pki-real-node-validity"
          />
          <Select
            label="Key algorithm"
            value={keyAlgo}
            onChange={(v) => {
              setKeyAlgo((v) ?? 'ed25519');
              setDirty(true);
            }}
            data={KEY_ALGOS}
            data-testid="pki-real-key-algo"
          />
        </Stack>
      </Card>

      <Group justify="flex-end">
        <Button
          loading={put.isPending}
          disabled={!dirty || !canWrite}
          onClick={() => {
            void save();
          }}
          data-testid="pki-real-save"
        >
          Save
        </Button>
      </Group>

      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>Revoked certificates</Title>
          {revoked.length === 0 ? (
            <Text size="sm" c="dimmed" data-testid="pki-real-no-revocations">
              No revocations.
            </Text>
          ) : (
            <Stack gap="xs">
              {revoked.map((r) => (
                <Group
                  key={r.id}
                  justify="space-between"
                  data-testid={`pki-real-revocation-${r.id}`}
                >
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>
                      {r.subject}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Revoked at {r.revoked_at} — reason: {r.reason}
                    </Text>
                  </Stack>
                  <Badge color="red" variant="light" size="xs">
                    Revoked
                  </Badge>
                </Group>
              ))}
            </Stack>
          )}
        </Stack>
      </Card>
    </Stack>
  );
}
