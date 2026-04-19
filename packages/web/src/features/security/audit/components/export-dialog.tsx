/**
 * <ExportDialog> — confirmation dialog before downloading audit export.
 */
import { Modal, Stack, Text, Group, Button, SegmentedControl } from '@mantine/core';
import { useState } from 'react';
import { IconDownload } from '@tabler/icons-react';
import type { ExportFormat } from '../types';

interface ExportDialogProps {
  opened: boolean;
  onClose: () => void;
  count: number;
  onExport: (format: ExportFormat) => void;
}

export function ExportDialog({ opened, onClose, count, onExport }: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>('csv');

  function handleExport() {
    onExport(format);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title="Export audit log"
      size="sm"
      data-testid="export-dialog"
    >
      <Stack gap="md">
        <Text size="sm">
          About to export <strong>{count}</strong> audit{' '}
          {count === 1 ? 'entry' : 'entries'} with current filters.
        </Text>

        <div>
          <Text size="sm" fw={500} mb={6}>
            Format
          </Text>
          <SegmentedControl
            value={format}
            onChange={(v) => { setFormat(v as 'csv' | 'jsonl'); }}
            data={[
              { value: 'csv', label: 'CSV' },
              { value: 'jsonl', label: 'JSONL' },
            ]}
            fullWidth
          />
        </div>

        <Group justify="flex-end" mt="xs">
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button
            leftSection={<IconDownload size={14} />}
            onClick={handleExport}
            disabled={count === 0}
          >
            Download
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
