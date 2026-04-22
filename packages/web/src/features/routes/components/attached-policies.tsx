/**
 * <AttachedPolicies> — list the access policies attached to a route and
 * expose an "Attach" picker modal for adding more. Each attached policy has
 * a "Detach" button.
 */
import { useMemo, useState } from 'react';
import { Alert, Badge, Button, Group, Modal, Stack, Table, Text } from '@mantine/core';
import { IconAlertCircle, IconPlus, IconShield } from '@tabler/icons-react';
import { useDisclosure } from '@mantine/hooks';
import { notify } from '@/hooks/use-notify';
import { usePolicyList, usePoliciesAttachedToRoute } from '@/features/policies';
import { attachPolicy, detachPolicy } from '../api';

interface AttachedPoliciesProps {
  routeId: string;
}

export function AttachedPolicies({ routeId }: AttachedPoliciesProps) {
  const attached = usePoliciesAttachedToRoute(routeId);
  const allPolicies = usePolicyList();

  const [pickerOpened, { open: openPicker, close: closePicker }] = useDisclosure(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const attachedIds = useMemo(() => new Set(attached.map((p) => p.id)), [attached]);
  const candidates = useMemo(
    () => allPolicies.filter((p) => !attachedIds.has(p.id)),
    [allPolicies, attachedIds],
  );

  async function handleAttach(policyId: string) {
    setBusyId(policyId);
    try {
      await attachPolicy(routeId, policyId);
      notify.success('Policy attached', 'The policy now applies to this route.');
    } catch {
      notify.error('Failed to attach policy', 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleDetach(policyId: string) {
    setBusyId(policyId);
    try {
      await detachPolicy(routeId, policyId);
      notify.success('Policy detached', 'The policy no longer applies.');
    } catch {
      notify.error('Failed to detach policy', 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={600}>
          Attached policies ({String(attached.length)})
        </Text>
        <Button
          size="xs"
          variant="light"
          leftSection={<IconPlus size={14} />}
          onClick={openPicker}
          disabled={candidates.length === 0}
        >
          Attach policy
        </Button>
      </Group>

      {attached.length === 0 ? (
        <Alert icon={<IconAlertCircle size={14} />} variant="light" color="gray" p="xs">
          <Text size="xs">No policies attached to this route.</Text>
        </Alert>
      ) : (
        <Table striped highlightOnHover>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Action</Table.Th>
              <Table.Th>Priority</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {attached.map((p) => (
              <Table.Tr key={p.id}>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <IconShield size={14} />
                    <Text size="xs">{p.name}</Text>
                  </Group>
                </Table.Td>
                <Table.Td>
                  <Badge size="xs" color={p.action === 'allow' ? 'green' : 'red'} variant="light">
                    {p.action}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" ff="monospace">
                    {String(p.priority)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Button
                    size="xs"
                    variant="subtle"
                    color="red.8"
                    loading={busyId === p.id}
                    onClick={() => void handleDetach(p.id)}
                  >
                    Detach
                  </Button>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Modal opened={pickerOpened} onClose={closePicker} title="Attach policy" size="md">
        <Stack gap="sm">
          {candidates.length === 0 ? (
            <Text size="sm" c="var(--mantine-color-gray-7)">
              All tenant policies are already attached.
            </Text>
          ) : (
            <Table striped highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Action</Table.Th>
                  <Table.Th />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {candidates.map((p) => (
                  <Table.Tr key={p.id}>
                    <Table.Td>
                      <Text size="xs">{p.name}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Badge
                        size="xs"
                        color={p.action === 'allow' ? 'green' : 'red'}
                        variant="light"
                      >
                        {p.action}
                      </Badge>
                    </Table.Td>
                    <Table.Td>
                      <Button
                        size="xs"
                        loading={busyId === p.id}
                        onClick={() => void handleAttach(p.id)}
                      >
                        Attach
                      </Button>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          )}
        </Stack>
      </Modal>
    </Stack>
  );
}
