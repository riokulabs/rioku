/**
 * <CreateEnrollmentModal> — modal for requesting a new certificate enrollment.
 *
 * Task 8b.7
 */
import { useState } from 'react';
import {
  Button,
  Group,
  Modal,
  NumberInput,
  Select,
  Stack,
  TagsInput,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconLock } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { addCertEnrollment, useCertAuthorities } from '../api';
import { createEnrollmentSchema } from '../schemas';
import type { CreateEnrollmentValues } from '../schemas';

// ─── Props ────────────────────────────────────────────────────────────────────

interface CreateEnrollmentModalProps {
  opened: boolean;
  onClose: () => void;
  tenantId: string;
  canWrite: boolean;
}

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULT_VALUES: CreateEnrollmentValues = {
  ca_id: '',
  subject: '',
  dns_sans: [],
  validity_days: 90,
};

// ─── Component ────────────────────────────────────────────────────────────────

export function CreateEnrollmentModal({
  opened,
  onClose,
  tenantId,
  canWrite,
}: CreateEnrollmentModalProps) {
  const [saving, setSaving] = useState(false);
  const cas = useCertAuthorities();

  const caOptions = cas.map((ca) => ({
    value: ca.id,
    label: `${ca.name} (${ca.kind})`,
  }));

  const form = useForm<CreateEnrollmentValues>({
    mode: 'controlled',
    initialValues: DEFAULT_VALUES,
    validate: schemaResolver(createEnrollmentSchema, { sync: true }),
  });

  async function handleSubmit(values: CreateEnrollmentValues) {
    if (!canWrite) return;
    setSaving(true);
    try {
      await addCertEnrollment(tenantId, values);
      notify.success(
        'Enrollment requested',
        `Certificate request for "${values.subject}" submitted.`,
      );
      form.reset();
      onClose();
    } catch (e) {
      notify.error('Enrollment failed', (e as Error).message);
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
      title="Request Certificate Enrollment"
      size="md"
      data-testid="create-enrollment-modal"
      transitionProps={{ duration: 0 }}
    >
      <form
        onSubmit={form.onSubmit((values) => {
          void handleSubmit(values);
        })}
      >
        <Stack gap="sm">
          <Select
            label="Certificate Authority"
            description="Which CA should issue this certificate"
            placeholder="Select a CA"
            data={caOptions}
            required
            data-testid="enrollment-ca-select"
            {...form.getInputProps('ca_id')}
          />

          <TextInput
            label="Subject"
            description="Common name or subject summary, e.g. CN=api.internal"
            placeholder="CN=api.internal"
            required
            data-testid="enrollment-subject-input"
            {...form.getInputProps('subject')}
          />

          <TagsInput
            label="DNS SANs"
            description="Subject Alternative Names — press Enter to add each hostname"
            placeholder="api.internal"
            data-testid="enrollment-sans-input"
            {...form.getInputProps('dns_sans')}
          />

          <NumberInput
            label="Validity (days)"
            description="1–3650 days"
            min={1}
            max={3650}
            required
            data-testid="enrollment-validity-input"
            {...form.getInputProps('validity_days')}
          />

          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={handleClose} data-testid="enrollment-cancel-button">
              Cancel
            </Button>
            <Tooltip label="Requires pki:write permission" disabled={canWrite}>
              <span>
                <Button
                  type="submit"
                  loading={saving}
                  disabled={!canWrite || saving}
                  leftSection={!canWrite ? <IconLock size={14} /> : undefined}
                  data-testid="enrollment-submit-button"
                >
                  Request certificate
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
