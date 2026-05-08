/**
 * Plugin sideload form — Plan 09 T5.
 *
 * Two file pickers (binary archive + manifest JSON) and a Submit. On success
 * we surface the install id; on failure we render the daemon's problem-detail
 * inline. The 501 from the stage-2 stub is rendered as a yellow Alert banner
 * with the explanation copied verbatim from the daemon.
 */
import { useState } from 'react';
import { Alert, Button, FileButton, Group, Paper, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCheck, IconUpload } from '@tabler/icons-react';
import { useSideloadPlugin, type SideloadResult } from './api';

export interface PluginSideloadFormProps {
  tenantSlug: string;
  /** Optional callback fired only on a 2xx daemon response. */
  onAccepted?: (installId: string | undefined) => void;
}

export function PluginSideloadForm({ tenantSlug, onAccepted }: PluginSideloadFormProps) {
  const [archive, setArchive] = useState<File | null>(null);
  const [manifest, setManifest] = useState<File | null>(null);
  const [result, setResult] = useState<SideloadResult | null>(null);

  const mutation = useSideloadPlugin();

  const canSubmit = archive !== null && manifest !== null && !mutation.isPending;

  function reset(): void {
    setArchive(null);
    setManifest(null);
    setResult(null);
    mutation.reset();
  }

  async function handleSubmit(): Promise<void> {
    if (!archive || !manifest) return;
    const r = await mutation.mutateAsync({ tenantSlug, archive, manifest });
    setResult(r);
    if (r.accepted && onAccepted !== undefined) onAccepted(r.installId);
  }

  return (
    <Paper withBorder p="md" radius="sm" data-testid="plugin-sideload-form">
      <Stack gap="md">
        <div>
          <Title order={4}>Sideload a plugin</Title>
          <Text size="sm" c="dimmed">
            Upload a built plugin archive (.so / .wasm) and its rioku-plugin.json manifest. The
            daemon validates the manifest, verifies the cosign signature, and stages the binary for
            activation.
          </Text>
        </div>

        <Group gap="md">
          <FileButton onChange={setArchive} accept=".so,.wasm,application/octet-stream">
            {(props) => (
              <Button
                {...props}
                leftSection={<IconUpload size={16} />}
                variant="default"
                data-testid="sideload-archive-button"
              >
                {archive ? archive.name : 'Choose archive'}
              </Button>
            )}
          </FileButton>
          <FileButton onChange={setManifest} accept="application/json,.json">
            {(props) => (
              <Button
                {...props}
                leftSection={<IconUpload size={16} />}
                variant="default"
                data-testid="sideload-manifest-button"
              >
                {manifest ? manifest.name : 'Choose manifest'}
              </Button>
            )}
          </FileButton>
        </Group>

        <Group justify="flex-end" gap="sm">
          <Button variant="subtle" onClick={reset} disabled={mutation.isPending}>
            Reset
          </Button>
          <Button
            onClick={() => {
              void handleSubmit();
            }}
            loading={mutation.isPending}
            disabled={!canSubmit}
            data-testid="sideload-submit"
          >
            Sideload
          </Button>
        </Group>

        {result?.accepted === true ? (
          <Alert
            color="green"
            icon={<IconCheck size={16} />}
            data-testid="sideload-success"
            title="Upload accepted"
          >
            Install id: <code>{result.installId ?? '(none)'}</code>
          </Alert>
        ) : null}

        {result !== null && !result.accepted ? (
          <Alert
            color={result.status === 501 ? 'yellow' : 'red'}
            icon={<IconAlertTriangle size={16} />}
            data-testid="sideload-error"
            title={result.errorTitle ?? 'Upload failed'}
          >
            {result.errorDetail ?? `HTTP ${String(result.status)}`}
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}
