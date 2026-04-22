/**
 * <CreateCaModal> — modal for creating a new Certificate Authority.
 *
 * Task 8b.7
 */
import { useState } from 'react';
import {
  Button,
  Group,
  Modal,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { addCertAuthority } from '../api';
import { createCaSchema } from '../schemas';
import type { CreateCaValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreateCaModalProps {
  opened: boolean;
  onClose: () => void;
  tenantId: string;
  canWrite: boolean;
}

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULT_VALUES: CreateCaValues = {
  name: '',
  kind: 'external',
  subject: '',
  certificate_pem: '',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateCaModal({ opened, onClose, tenantId, canWrite }: CreateCaModalProps) {
  const [saving, setSaving] = useState(false);

  const form = useForm<CreateCaValues>({
    mode: 'controlled',
    initialValues: DEFAULT_VALUES,
    validate: schemaResolver(createCaSchema, { sync: true }),
  });

  const isExternal = form.values.kind === 'external';

  async function handleSubmit(values: CreateCaValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await addCertAuthority(tenantId, values);
      notify.success('Certificate Authority created', `"${values.name}" has been added.`);
      form.reset();
      onClose();
    } catch (e) {
      notify.error('Create CA failed', (e as Error).message);
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
      title="Create Certificate Authority"
      size="md"
      data-testid="create-ca-modal"
      transitionProps={{ duration: 0 }}
    >
      <form
        onSubmit={form.onSubmit((values) => {
          void handleSubmit(values);
        })}
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            description="Display name for this CA"
            placeholder="My Internal Root CA"
            required
            data-testid="ca-name-input"
            {...form.getInputProps('name')}
          />

          <Stack gap={4}>
            <Text size="sm" fw={500}>
              Kind
            </Text>
            <SegmentedControl
              data={[
                { value: 'external', label: 'External' },
                { value: 'internal', label: 'Internal (Rioku-managed)' },
              ]}
              data-testid="ca-kind-control"
              {...form.getInputProps('kind')}
            />
          </Stack>

          <TextInput
            label="Subject"
            description="Distinguished name, e.g. CN=My Root CA, O=Acme"
            placeholder="CN=My Root CA"
            required
            data-testid="ca-subject-input"
            {...form.getInputProps('subject')}
          />

          {isExternal && (
            <Textarea
              label="Certificate PEM"
              description="Paste the full PEM-encoded certificate"
              placeholder="-----BEGIN CERTIFICATE-----&#10;...&#10;-----END CERTIFICATE-----"
              required={isExternal}
              rows={6}
              data-testid="ca-pem-input"
              {...form.getInputProps('certificate_pem')}
            />
          )}

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={handleClose} data-testid="ca-cancel-button">
              Cancel
            </Button>
            <Tooltip label="Requires pki:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="ca-submit-button"
                >
                  Create CA
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
