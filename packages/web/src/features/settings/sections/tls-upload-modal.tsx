/**
 * <TlsUploadModal> — modal for uploading a manual TLS certificate + private key.
 *
 * Uses @mantine/dropzone for cert and key PEM file drops, plus a TextInput for
 * the domain. The private key (key_pem) is validated by schema but never stored
 * — it is discarded after the upload succeeds.
 *
 * Task 8b.8
 */
import { useState } from 'react';
import { Button, Group, Modal, Stack, Text, Textarea, TextInput, Tooltip } from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { Dropzone } from '@mantine/dropzone';
import { IconLock, IconUpload, IconX, IconFile } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { addTlsCertificate } from '../api';
import { tlsUploadSchema } from '../schemas';
import type { TlsUploadValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface TlsUploadModalProps {
  opened: boolean;
  onClose: () => void;
  tenantId: string;
  canWrite: boolean;
}

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULT_VALUES: TlsUploadValues = {
  domain: '',
  certificate_pem: '',
  key_pem: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve(reader.result as string);
    };
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    reader.readAsText(file);
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TlsUploadModal({ opened, onClose, tenantId, canWrite }: TlsUploadModalProps) {
  const [saving, setSaving] = useState(false);

  const form = useForm<TlsUploadValues>({
    mode: 'controlled',
    initialValues: DEFAULT_VALUES,
    validate: schemaResolver(tlsUploadSchema, { sync: true }),
  });

  async function handleCertDrop(files: File[]) {
    const file = files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      form.setFieldValue('certificate_pem', text);
    } catch {
      notify.error('Read failed', 'Could not read certificate file.');
    }
  }

  async function handleKeyDrop(files: File[]) {
    const file = files[0];
    if (!file) return;
    try {
      const text = await readFileAsText(file);
      form.setFieldValue('key_pem', text);
    } catch {
      notify.error('Read failed', 'Could not read key file.');
    }
  }

  async function handleSubmit(values: TlsUploadValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      // key_pem is validated by schema above but NOT passed to addTlsCertificate —
      // private keys must never be persisted in frontend state.
      await addTlsCertificate(tenantId, values);
      notify.success('Certificate uploaded', `Certificate for "${values.domain}" has been added.`);
      form.reset();
      onClose();
    } catch (e) {
      notify.error('Upload failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function handleClose() {
    form.reset();
    onClose();
  }

  // duration=0 prevents JSDOM animation hangs in tests
  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Upload TLS Certificate"
      size="md"
      data-testid="tls-upload-modal"
      transitionProps={{ duration: 0 }}
    >
      <form
        onSubmit={form.onSubmit((values) => {
          void handleSubmit(values);
        })}
      >
        <Stack gap="sm">
          <TextInput
            label="Domain"
            description="The domain this certificate covers, e.g. api.example.com"
            placeholder="api.example.com"
            required
            data-testid="upload-domain-input"
            {...form.getInputProps('domain')}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Certificate PEM{' '}
              <Text span c="red">
                *
              </Text>
            </Text>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Drop a .pem or .crt file, or paste below
            </Text>
            <Dropzone
              onDrop={(files) => {
                void handleCertDrop(files);
              }}
              accept={['application/x-pem-file', 'text/plain', '.pem', '.crt', '.cer']}
              maxFiles={1}
              data-testid="cert-pem-dropzone"
            >
              <Dropzone.Accept>
                <Group justify="center" gap="xs" p="xs">
                  <IconUpload size={20} />
                  <Text size="sm">Drop certificate file here</Text>
                </Group>
              </Dropzone.Accept>
              <Dropzone.Reject>
                <Group justify="center" gap="xs" p="xs">
                  <IconX size={20} />
                  <Text size="sm">Unsupported file type</Text>
                </Group>
              </Dropzone.Reject>
              <Dropzone.Idle>
                <Group justify="center" gap="xs" p="xs">
                  <IconFile size={20} />
                  <Text size="sm">Drop .pem/.crt file or click to browse</Text>
                </Group>
              </Dropzone.Idle>
            </Dropzone>
            <Textarea
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              rows={4}
              data-testid="cert-pem-textarea"
              {...form.getInputProps('certificate_pem')}
            />
          </Stack>

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Private Key PEM{' '}
              <Text span c="red">
                *
              </Text>
            </Text>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Drop a .pem or .key file, or paste below. The key is validated but never stored.
            </Text>
            <Dropzone
              onDrop={(files) => {
                void handleKeyDrop(files);
              }}
              accept={['application/x-pem-file', 'text/plain', '.pem', '.key']}
              maxFiles={1}
              data-testid="key-pem-dropzone"
            >
              <Dropzone.Accept>
                <Group justify="center" gap="xs" p="xs">
                  <IconUpload size={20} />
                  <Text size="sm">Drop key file here</Text>
                </Group>
              </Dropzone.Accept>
              <Dropzone.Reject>
                <Group justify="center" gap="xs" p="xs">
                  <IconX size={20} />
                  <Text size="sm">Unsupported file type</Text>
                </Group>
              </Dropzone.Reject>
              <Dropzone.Idle>
                <Group justify="center" gap="xs" p="xs">
                  <IconFile size={20} />
                  <Text size="sm">Drop .pem/.key file or click to browse</Text>
                </Group>
              </Dropzone.Idle>
            </Dropzone>
            <Textarea
              placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
              rows={4}
              data-testid="key-pem-textarea"
              {...form.getInputProps('key_pem')}
            />
          </Stack>

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={handleClose} data-testid="upload-cancel-button">
              Cancel
            </Button>
            <Tooltip label="Requires tls:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="upload-submit-button"
                >
                  Upload certificate
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
