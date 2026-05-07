/**
 * <UninstallPluginModal> — confirm destructive uninstall.
 *
 * User must type the plugin slug to confirm.
 */
import { useState } from 'react';
import { Alert, Button, Group, Modal, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { uninstallPlugin } from '../api';
import type { Plugin } from '../types';

interface UninstallPluginModalProps {
  plugin: Plugin | null;
  opened: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /**
   * Tenant slug for the daemon DELETE call. Required when invoking
   * against the real daemon; legacy stage-1 callers may omit it (the
   * mutation becomes a no-op).
   */
  tenantId?: string;
}

export function UninstallPluginModal({
  plugin,
  opened,
  onClose,
  onSuccess,
  tenantId = '',
}: UninstallPluginModalProps) {
  const [slugInput, setSlugInput] = useState('');
  const [loading, setLoading] = useState(false);

  function handleClose() {
    setSlugInput('');
    onClose();
  }

  async function handleConfirm() {
    if (!plugin) return;
    if (slugInput !== plugin.slug) return;
    setLoading(true);
    try {
      await uninstallPlugin(plugin.id, tenantId);
      notify.success('Plugin uninstalled', `${plugin.display_name} was removed.`);
      setSlugInput('');
      onSuccess();
    } catch {
      notify.error('Failed to uninstall plugin', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={plugin ? `Uninstall ${plugin.display_name}?` : 'Uninstall plugin'}
      size="md"
    >
      {plugin && (
        <Stack gap="md">
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            Uninstalling removes the plugin and its declared permissions from this Rioku instance.
            Any routes or services depending on this plugin will stop working until it is
            reinstalled.
          </Alert>

          <Text size="sm">
            Type the plugin slug{' '}
            <Text component="span" fw={600} ff="monospace">
              {plugin.slug}
            </Text>{' '}
            to confirm.
          </Text>

          <TextInput
            value={slugInput}
            onChange={(e) => {
              setSlugInput(e.currentTarget.value);
            }}
            placeholder={plugin.slug}
            aria-label="Confirm plugin slug"
            data-autofocus
          />

          <Group justify="flex-end" gap="sm">
            <Button variant="default" onClick={handleClose}>
              Cancel
            </Button>
            <Button
              color="red.8"
              loading={loading}
              disabled={slugInput !== plugin.slug}
              onClick={() => void handleConfirm()}
            >
              Uninstall permanently
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
