/* eslint-disable react-hooks/set-state-in-effect -- form state hydrates from server fetch on first load; this is the correct pattern */
/**
 * Real-API TLS section.
 *
 * Reads via `useGetSettingsTLS`, replaces via `usePutSettingsTLS`.
 *
 * Surface:
 *   - ACME issuer dropdown (lets-encrypt staging/prod, ZeroSSL, Buypass, custom)
 *   - ACME account email
 *   - Custom directory URL (when issuer === custom)
 *   - List of currently uploaded manual certs (subject + expiry + auto-renew)
 *   - Manual cert upload form (cert PEM + key PEM textareas, "Upload" button)
 *
 * The manual upload posts to `/api/v1/t/{tenant}/settings/tls/manual`.
 * Until that daemon endpoint is exercised the UI surfaces a clear error
 * to the operator.
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconAlertCircle, IconTrash, IconUpload } from '@tabler/icons-react';
import { useGetSettingsTLS, usePutSettingsTLS } from '@/api/generated/settings/settings';
import type { SettingsTLSManualCertRefsItem } from '@/api/generated/schemas/settingsTLSManualCertRefsItem';
import type { SettingsTLSAcmeIssuer } from '@/api/generated/schemas/settingsTLSAcmeIssuer';
import { customFetch } from '@/api/mutator';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { unwrap } from './_unwrap';

interface TlsRealSectionProps {
  tenant: string;
}

const ACME_OPTIONS: { value: SettingsTLSAcmeIssuer; label: string }[] = [
  { value: 'lets-encrypt-staging', label: "Let's Encrypt (staging)" },
  { value: 'lets-encrypt-prod', label: "Let's Encrypt (production)" },
  { value: 'zerossl', label: 'ZeroSSL' },
  { value: 'custom', label: 'Custom (Pebble / private)' },
];

interface ManualUploadResponse {
  id?: string;
  ref?: SettingsTLSManualCertRefsItem;
}

export function TlsRealSection({ tenant }: TlsRealSectionProps) {
  const q = useGetSettingsTLS(tenant);
  const put = usePutSettingsTLS();
  const canWrite = usePermission('tls:write');

  const [issuer, setIssuer] = useState<SettingsTLSAcmeIssuer>('lets-encrypt-staging');
  const [email, setEmail] = useState('');
  const [directoryUrl, setDirectoryUrl] = useState('');
  const [autoRenew, setAutoRenew] = useState(true);
  const [refs, setRefs] = useState<SettingsTLSManualCertRefsItem[]>([]);
  const [dirty, setDirty] = useState(false);

  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  useEffect(() => {
    const d = unwrap<{
      acmeIssuer?: string;
      acmeEmail?: string;
      acmeDirectoryUrl?: string;
      manualCertRefs?: SettingsTLSManualCertRefsItem[];
      allowedCiphers?: string[];
    }>(q.data);
    if (!d || dirty) return;
    setIssuer((d.acmeIssuer as SettingsTLSAcmeIssuer | undefined) ?? 'lets-encrypt-staging');
    setEmail(d.acmeEmail ?? '');
    setDirectoryUrl(d.acmeDirectoryUrl ?? '');
    setRefs(d.manualCertRefs ?? []);
    // auto-renew is a per-cert flag in the schema; we surface the global default
    setAutoRenew(true);
  }, [q.data, dirty]);

  if (q.isLoading)
    return (
      <Stack align="center" py="xl" data-testid="tls-real-loading">
        <Loader />
      </Stack>
    );
  if (q.isError)
    return (
      <Alert color="red" data-testid="tls-real-error">
        Failed to load TLS config: {(q.error as Error).message}
      </Alert>
    );

  async function saveAcme() {
    try {
      const payload: Record<string, unknown> = {
        acmeIssuer: issuer,
        acmeEmail: email,
        manualCertRefs: refs,
      };
      if (issuer === 'custom') payload.acmeDirectoryUrl = directoryUrl;
      const cur = unwrap<{ allowedCiphers?: string[] }>(q.data);
      if (cur?.allowedCiphers) payload.allowedCiphers = cur.allowedCiphers;
      await put.mutateAsync({
        tenant,
        data: payload,
      });
      notify.success('TLS configuration saved');
      setDirty(false);
      await q.refetch();
    } catch (err) {
      notify.error('Save failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  async function uploadCert() {
    setUploading(true);
    setUploadErr(null);
    try {
      // Lightweight client-side PEM sanity check.
      if (!certPem.trim().startsWith('-----BEGIN')) {
        throw new Error('Cert PEM must start with -----BEGIN.');
      }
      if (!keyPem.trim().startsWith('-----BEGIN')) {
        throw new Error('Key PEM must start with -----BEGIN.');
      }
      const res = await customFetch<ManualUploadResponse>({
        url: `/t/${encodeURIComponent(tenant)}/settings/tls/manual`,
        method: 'POST',
        data: { cert_pem: certPem, key_pem: keyPem, auto_renew: autoRenew },
      });
      const newRef = res.ref;
      if (newRef) {
        setRefs((prev) => [...prev, newRef]);
      }
      setCertPem('');
      setKeyPem('');
      notify.success('Certificate uploaded');
      await q.refetch();
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function deleteCert(id: string) {
    try {
      await customFetch<undefined>({
        url: `/t/${encodeURIComponent(tenant)}/settings/tls/manual/${encodeURIComponent(id)}`,
        method: 'DELETE',
      });
      setRefs((prev) => prev.filter((r) => r.id !== id));
      notify.success('Certificate deleted');
      await q.refetch();
    } catch (err) {
      notify.error('Delete failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  return (
    <Stack gap="lg" data-testid="tls-real-section">
      <Title order={4}>TLS</Title>

      {!canWrite && (
        <Alert color="yellow" icon={<IconAlertCircle size={14} />} data-testid="tls-real-readonly">
          You have read-only access. The <code>tls:write</code> permission is required to save
          changes or upload certs.
        </Alert>
      )}

      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>ACME issuer</Title>
          <Select
            label="Issuer"
            value={issuer}
            onChange={(v) => {
              setIssuer(v ?? 'lets-encrypt-staging');
              setDirty(true);
            }}
            data={ACME_OPTIONS}
            data-testid="tls-real-issuer"
          />
          <TextInput
            label="ACME account email"
            value={email}
            onChange={(e) => {
              setEmail(e.currentTarget.value);
              setDirty(true);
            }}
            data-testid="tls-real-email"
          />
          {issuer === 'custom' && (
            <TextInput
              label="Custom directory URL (e.g. https://localhost:14000/dir for Pebble)"
              value={directoryUrl}
              onChange={(e) => {
                setDirectoryUrl(e.currentTarget.value);
                setDirty(true);
              }}
              data-testid="tls-real-directory"
            />
          )}
          <Switch
            label="Auto-renew certificates"
            checked={autoRenew}
            onChange={(e) => {
              setAutoRenew(e.currentTarget.checked);
              setDirty(true);
            }}
            data-testid="tls-real-autorenew"
          />
          <Group justify="flex-end">
            <Button
              loading={put.isPending}
              disabled={!dirty || !canWrite}
              onClick={() => {
                void saveAcme();
              }}
              data-testid="tls-real-save"
            >
              Save
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>Manual certificate upload</Title>
          <Text size="xs" c="dimmed">
            Paste PEM-encoded certificate and private key. The daemon validates both and stores them
            in the cert store; Caddy reload runs after a successful upload.
          </Text>
          <Textarea
            label="Certificate (PEM)"
            value={certPem}
            onChange={(e) => {
              setCertPem(e.currentTarget.value);
            }}
            minRows={6}
            placeholder="-----BEGIN CERTIFICATE-----..."
            data-testid="tls-real-cert-pem"
          />
          <Textarea
            label="Private key (PEM)"
            value={keyPem}
            onChange={(e) => {
              setKeyPem(e.currentTarget.value);
            }}
            minRows={6}
            placeholder="-----BEGIN PRIVATE KEY-----..."
            data-testid="tls-real-key-pem"
          />
          {uploadErr && (
            <Alert color="red" data-testid="tls-real-upload-error">
              {uploadErr}
            </Alert>
          )}
          <Group justify="flex-end">
            <Button
              leftSection={<IconUpload size={14} />}
              loading={uploading}
              disabled={!canWrite || !certPem.trim() || !keyPem.trim()}
              onClick={() => {
                void uploadCert();
              }}
              data-testid="tls-real-upload"
            >
              Upload
            </Button>
          </Group>
        </Stack>
      </Card>

      <Card withBorder>
        <Stack gap="sm">
          <Title order={6}>Uploaded certificates</Title>
          {refs.length === 0 ? (
            <Text size="sm" c="dimmed" data-testid="tls-real-no-certs">
              No manual certificates uploaded.
            </Text>
          ) : (
            <Stack gap="xs">
              {refs.map((ref) => {
                const id = ref.id ?? '';
                return (
                  <Group
                    key={id}
                    justify="space-between"
                    wrap="nowrap"
                    data-testid={`tls-real-cert-${id}`}
                  >
                    <Stack gap={2}>
                      <Group gap="xs">
                        <Text size="sm" fw={500}>
                          {ref.subject ?? id}
                        </Text>
                        {ref.autoRenew && (
                          <Badge size="xs" color="blue" variant="light">
                            Auto-renew
                          </Badge>
                        )}
                      </Group>
                      <Text size="xs" c="dimmed">
                        Issuer: {ref.issuer ?? 'unknown'} — expires {ref.notAfter ?? 'unknown'}
                      </Text>
                    </Stack>
                    <Button
                      size="xs"
                      variant="subtle"
                      color="red"
                      leftSection={<IconTrash size={12} />}
                      disabled={!canWrite}
                      onClick={() => {
                        void deleteCert(id);
                      }}
                      data-testid={`tls-real-delete-${id}`}
                    >
                      Delete
                    </Button>
                  </Group>
                );
              })}
            </Stack>
          )}
        </Stack>
      </Card>

      <Text size="xs" c="dimmed">
        Audit is emitted server-side for every PUT/upload/delete.
      </Text>
    </Stack>
  );
}
