/**
 * <ImportDashboardModal> — two-tab modal used from the dashboards list page.
 *
 *   - "Paste JSON" tab: textarea, validates onSubmit.
 *   - "Upload file" tab: Mantine `<FileInput>` with `.json` accept.
 *
 * Validation goes through `importDashboardJson` from the API layer, which
 * parses the payload through the Zod export schema. Failures surface as an
 * inline `<Alert>` with the first Zod issue message. On success the modal
 * closes and `onImported` fires with the newly-created dashboard so the
 * caller can navigate to its viewer.
 *
 * Permissions: the caller is expected to gate the trigger button on
 * `dashboard:write`. The modal itself does not re-check.
 */
import { useCallback, useState } from 'react';
import {
  Alert,
  Button,
  FileInput,
  Group,
  Modal,
  Stack,
  Tabs,
  Text,
  Textarea,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconClipboard,
  IconUpload,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import type { Dashboard } from '@/api/resources/types';
import { importDashboardJson } from '../api';
import { DashboardImportError } from '../types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ImportDashboardModalProps {
  opened: boolean;
  tenantId: string;
  onClose: () => void;
  onImported: (dashboard: Dashboard) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsText(file);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ImportDashboardModal({
  opened,
  tenantId,
  onClose,
  onImported,
}: ImportDashboardModalProps) {
  const [tab, setTab] = useState<'paste' | 'upload'>('paste');
  const [json, setJson] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setJson('');
    setFile(null);
    setError(null);
    setTab('paste');
  }, []);

  const handleClose = useCallback(() => {
    if (busy) return;
    reset();
    onClose();
  }, [busy, reset, onClose]);

  const handleImport = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      let payload = json;
      if (tab === 'upload') {
        if (!file) {
          setError('Select a JSON file to import.');
          setBusy(false);
          return;
        }
        payload = await readFileAsText(file);
      } else if (payload.trim() === '') {
        setError('Paste the exported JSON to import.');
        setBusy(false);
        return;
      }

      const imported = await importDashboardJson(tenantId, payload);
      notify.success('Dashboard imported', `Created ${imported.name}.`);
      reset();
      onClose();
      onImported(imported);
    } catch (e) {
      if (e instanceof DashboardImportError) {
        setError(e.message);
      } else {
        setError((e as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }, [json, tab, file, tenantId, reset, onClose, onImported]);

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Import dashboard"
      centered
      size="lg"
      data-testid="import-dashboard-modal"
    >
      <Stack gap="md">
        <Tabs
          value={tab}
          onChange={(next) => {
            if (next === 'paste' || next === 'upload') setTab(next);
          }}
        >
          <Tabs.List>
            <Tabs.Tab
              value="paste"
              leftSection={<IconClipboard size={14} />}
              data-testid="import-tab-paste"
            >
              Paste JSON
            </Tabs.Tab>
            <Tabs.Tab
              value="upload"
              leftSection={<IconUpload size={14} />}
              data-testid="import-tab-upload"
            >
              Upload file
            </Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="paste" pt="sm">
            <Textarea
              label="Exported dashboard JSON"
              placeholder='{"version":"plan4-v1", …}'
              rows={10}
              value={json}
              onChange={(e) => {
                setJson(e.currentTarget.value);
              }}
              data-testid="import-json-textarea"
              spellCheck={false}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)', fontSize: 12 } }}
            />
          </Tabs.Panel>

          <Tabs.Panel value="upload" pt="sm">
            <FileInput
              label="JSON file"
              placeholder="Click to pick a .json file"
              accept="application/json,.json"
              value={file}
              onChange={setFile}
              data-testid="import-file-input"
            />
          </Tabs.Panel>
        </Tabs>

        {error !== null && (
          <Alert
            color="red"
            variant="light"
            icon={<IconAlertCircle size={16} />}
            title="Import failed"
            data-testid="import-error"
          >
            <Text size="sm">{error}</Text>
          </Alert>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            loading={busy}
            onClick={() => {
              void handleImport();
            }}
            data-testid="import-dashboard-confirm"
          >
            Import
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
