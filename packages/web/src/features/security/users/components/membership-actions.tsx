/**
 * <MembershipActions> — inline action buttons for user lifecycle transitions.
 *
 * The real API folds membership state into the user record (see api.ts);
 * the synthesized "membership" exposes `state` derived from `user.disabled`
 * and the appropriate user lifecycle endpoint is called for each transition.
 *
 *   pending      → activate           (real: activateUser)
 *   active       → deactivate         (real: suspendUser)
 *   any          → remove             (real: deleteUser; typed-confirm tenant slug)
 */
import { useState } from 'react';
import { Button, Group, Modal, Text, TextInput, Stack, Alert } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useUserMutations } from '../api';
import type { Membership } from '../types';

interface MembershipActionsProps {
  membership: Membership;
  tenantSlug: string;
  /** Called after a state change so parent can refresh / close. */
  onChanged?: () => void;
}

export function MembershipActions({ membership, tenantSlug, onChanged }: MembershipActionsProps) {
  const [loading, setLoading] = useState(false);

  const { activateMembership, deactivateMembership, removeMembership } = useUserMutations(
    membership.tenant_id,
  );

  // Deactivate confirm modal
  const [deactivateOpened, { open: openDeactivate, close: closeDeactivate }] = useDisclosure(false);

  // Remove confirm modal
  const [removeOpened, { open: openRemove, close: closeRemove }] = useDisclosure(false);
  const [removeSlugInput, setRemoveSlugInput] = useState('');

  async function handleActivate() {
    setLoading(true);
    try {
      await activateMembership(membership.user_id);
      notify.success('User activated', 'The user can now access this tenant.');
      onChanged?.();
    } catch {
      notify.error('Activation failed', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeactivateConfirm() {
    setLoading(true);
    try {
      await deactivateMembership(membership.user_id);
      notify.success('User deactivated', 'The user has been suspended.');
      closeDeactivate();
      onChanged?.();
    } catch {
      notify.error('Deactivation failed', 'Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleRemoveConfirm() {
    if (removeSlugInput !== tenantSlug) return;
    setLoading(true);
    try {
      await removeMembership(membership.user_id);
      notify.success('User removed', 'The user has been removed from this tenant.');
      closeRemove();
      onChanged?.();
    } catch {
      notify.error('Remove failed', 'Please try again.');
    } finally {
      setLoading(false);
      setRemoveSlugInput('');
    }
  }

  return (
    <>
      <Group gap="xs" wrap="nowrap">
        {membership.state === 'pending' && (
          <Button
            size="xs"
            variant="light"
            color="green"
            loading={loading}
            onClick={() => void handleActivate()}
          >
            Activate
          </Button>
        )}

        {membership.state === 'active' && (
          <Button size="xs" variant="light" color="orange" onClick={openDeactivate}>
            Deactivate
          </Button>
        )}

        {membership.state === 'deactivated' && (
          <Button
            size="xs"
            variant="light"
            color="green"
            loading={loading}
            onClick={() => void handleActivate()}
          >
            Re-activate
          </Button>
        )}

        {membership.state !== 'removed' && (
          <Button size="xs" variant="subtle" color="red.8" onClick={openRemove}>
            Remove
          </Button>
        )}
      </Group>

      {/* Deactivate confirm modal */}
      <Modal opened={deactivateOpened} onClose={closeDeactivate} title="Deactivate user" size="sm">
        <Stack gap="md">
          <Text size="sm">
            This will suspend the user&apos;s access. They can be re-activated at any time.
          </Text>
          <Group justify="flex-end" gap="sm">
            <Button variant="default" size="sm" onClick={closeDeactivate}>
              Cancel
            </Button>
            <Button
              color="orange"
              size="sm"
              loading={loading}
              onClick={() => void handleDeactivateConfirm()}
            >
              Deactivate
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Remove confirm modal — requires typing the tenant slug */}
      <Modal
        opened={removeOpened}
        onClose={() => {
          closeRemove();
          setRemoveSlugInput('');
        }}
        title="Remove user from tenant"
        size="sm"
      >
        <Stack gap="md">
          <Alert icon={<IconAlertCircle size={16} />} color="red" variant="light">
            This permanently removes the user. All their roles and access will be revoked. This
            cannot be undone without re-creating the user.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {tenantSlug}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={removeSlugInput}
            onChange={(e) => {
              setRemoveSlugInput(e.currentTarget.value);
            }}
            placeholder={tenantSlug}
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeRemove();
                setRemoveSlugInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red.8"
              size="sm"
              loading={loading}
              disabled={removeSlugInput !== tenantSlug}
              onClick={() => void handleRemoveConfirm()}
            >
              Remove from tenant
            </Button>
          </Group>
        </Stack>
      </Modal>
    </>
  );
}
