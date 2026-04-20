/**
 * <ProfilePasswordModal> — "Change password" modal with current/new/confirm
 * fields and schemaResolver-based validation.
 *
 * Task 8a.2
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { changePassword } from '../api';
import { changePasswordSchema, type ChangePasswordValues } from '../schemas';

interface ProfilePasswordModalProps {
  userId: string;
  opened: boolean;
  onClose: () => void;
}

const INITIAL_VALUES: ChangePasswordValues = {
  current_password: '',
  new_password: '',
  confirm_password: '',
};

export function ProfilePasswordModal({
  userId,
  opened,
  onClose,
}: ProfilePasswordModalProps) {
  const canUpdate = usePermission('user:update-own');
  const [loading, setLoading] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ChangePasswordValues>({
    initialValues: INITIAL_VALUES,
    validate: schemaResolver(changePasswordSchema, { sync: true }),
  });

  async function handleSubmit(values: ChangePasswordValues) {
    setLoading(true);
    setServerError(null);
    try {
      const result = await changePassword(userId, values.current_password);
      if (!result.ok) {
        setServerError(result.error ?? 'Password change failed.');
        return;
      }
      notify.success('Password changed', 'Your password has been updated.');
      form.reset();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to change password';
      setServerError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    form.reset();
    setServerError(null);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Change password"
      data-testid="password-change-modal"
    >
      <form
        onSubmit={form.onSubmit((v) => {
          void handleSubmit(v);
        })}
        data-testid="password-change-form"
      >
        <Stack gap="sm">
          {serverError && (
            <Alert
              icon={<IconAlertCircle size={14} />}
              color="red"
              variant="light"
              data-testid="password-change-error"
            >
              {serverError}
            </Alert>
          )}
          <PasswordInput
            label="Current password"
            required
            disabled={!canUpdate}
            data-testid="password-current"
            {...form.getInputProps('current_password')}
          />
          <PasswordInput
            label="New password"
            description="Minimum 8 characters."
            required
            disabled={!canUpdate}
            data-testid="password-new"
            {...form.getInputProps('new_password')}
          />
          <PasswordInput
            label="Confirm new password"
            required
            disabled={!canUpdate}
            data-testid="password-confirm"
            {...form.getInputProps('confirm_password')}
          />
          <Group justify="flex-end" gap="sm" mt="xs">
            <Button variant="default" onClick={handleClose} data-testid="password-cancel">
              Cancel
            </Button>
            <Tooltip
              label="You don't have permission to update your profile"
              disabled={canUpdate}
              withArrow
            >
              <span>
                <Button
                  type="submit"
                  loading={loading}
                  disabled={!canUpdate}
                  data-testid="password-submit"
                >
                  Change password
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
