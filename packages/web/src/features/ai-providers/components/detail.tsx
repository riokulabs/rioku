/**
 * <ProviderDetail> — drawer content for an AI provider.
 *
 * Sections:
 *   - Header (name, kind badge, enabled switch, credential prefix chip, Rotate)
 *   - Base URL + description
 *   - ModelManager (models table + add form)
 *   - Agents using this provider (nested list)
 *   - Actions (Edit, Test connection, Delete — typed-name confirm)
 *   - Audit tail (last 10 entries for resource_type='ai-provider')
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  PasswordInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconPlugConnected,
  IconRobot,
  IconRotate,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { ProviderKindBadge } from '@/features/ai-shared';
import {
  deleteProvider,
  testProvider,
  updateProvider,
  useProviderAgents,
  useProviderDetail,
} from '../api';
import { ProviderInUseError } from '../types';
import type { TestProviderResult } from '../types';
import { ModelManager } from './model-manager';

dayjs.extend(relativeTime);

interface ProviderDetailProps {
  providerId: string;
  onEdit: () => void;
  onClose: () => void;
}

export function ProviderDetail({
  providerId,
  onEdit,
  onClose,
}: ProviderDetailProps) {
  const provider = useProviderDetail(providerId);
  const agentsUsing = useProviderAgents(providerId);
  const auditEntries = useMockStore((s) => s.audit);

  const auditTail = useMemo(() => {
    if (!provider) return [];
    return auditEntries
      .filter(
        (e) =>
          e.resource_type === 'ai-provider' && e.resource_id === provider.id,
      )
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, provider]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] =
    useDisclosure(false);
  const [rotateOpened, { open: openRotate, close: closeRotate }] =
    useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestProviderResult | null>(null);
  const [rotateValue, setRotateValue] = useState('');
  const [rotating, setRotating] = useState(false);

  if (!provider) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Provider not found.
      </Alert>
    );
  }

  async function handleTest() {
    if (!provider) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testProvider(provider.id);
      setTestResult(result);
      if (result.ok) {
        notify.success(
          'Connection OK',
          `${provider.name} responded in ${String(result.latency_ms)}ms.`,
        );
      } else {
        notify.error(
          'Connection failed',
          result.error_message ?? 'Upstream error',
        );
      }
    } catch {
      notify.error('Failed to test provider', 'Please try again.');
    } finally {
      setTesting(false);
    }
  }

  async function handleDelete() {
    if (!provider) return;
    if (deleteInput !== provider.name) return;
    setDeleting(true);
    try {
      await deleteProvider(provider.id);
      notify.success('Provider deleted', `${provider.name} was removed.`);
      closeDelete();
      onClose();
    } catch (err) {
      if (err instanceof ProviderInUseError) {
        notify.error(
          'Cannot delete — in use',
          `${String(err.agentIds.length)} agent(s) still reference this provider.`,
        );
      } else {
        notify.error('Failed to delete provider', 'Please try again.');
      }
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  async function handleRotate() {
    if (!provider) return;
    if (rotateValue === '') return;
    setRotating(true);
    try {
      await updateProvider(provider.id, { credential: rotateValue });
      notify.success('Credential rotated', `${provider.name} credential updated.`);
      closeRotate();
      setRotateValue('');
    } catch {
      notify.error('Failed to rotate credential', 'Please try again.');
    } finally {
      setRotating(false);
    }
  }

  async function handleToggleEnabled(enabled: boolean) {
    if (!provider) return;
    try {
      await updateProvider(provider.id, { enabled });
    } catch {
      notify.error('Failed to update provider', 'Please try again.');
    }
  }

  const deleteBlocked = agentsUsing.length > 0;

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconRobot size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4} ff="monospace">
                {provider.name}
              </Title>
              <ProviderKindBadge kind={provider.kind} />
              <Switch
                size="sm"
                checked={provider.enabled}
                aria-label={`Toggle ${provider.name}`}
                onChange={(e) => {
                  void handleToggleEnabled(e.currentTarget.checked);
                }}
              />
            </Group>
            {provider.description && (
              <Text size="sm" c="var(--mantine-color-gray-7)">
                {provider.description}
              </Text>
            )}
          </Stack>
        </Group>
        <Button variant="default" size="xs" onClick={onClose}>
          Close
        </Button>
      </Group>

      <Divider />

      {/* Identity */}
      <Stack gap="xs">
        <Group gap="xs">
          <Text size="sm" fw={600}>
            Base URL
          </Text>
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {provider.base_url}
          </Text>
        </Group>
        <Group gap="xs" align="center">
          <Text size="sm" fw={600}>
            Credential
          </Text>
          <Badge size="sm" variant="outline" color="gray" ff="monospace">
            {provider.credential_ref.prefix}…
          </Badge>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            created {dayjs(provider.credential_ref.created_at).fromNow()}
          </Text>
          <Button
            size="xs"
            variant="subtle"
            leftSection={<IconRotate size={14} />}
            onClick={openRotate}
          >
            Rotate
          </Button>
        </Group>
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          size="sm"
          variant="light"
          leftSection={<IconPlugConnected size={14} />}
          loading={testing}
          onClick={() => void handleTest()}
        >
          Test connection
        </Button>
        <Button
          size="sm"
          variant="subtle"
          color="red"
          disabled={deleteBlocked}
          onClick={openDelete}
          title={
            deleteBlocked
              ? 'Remove dependent agents before deleting'
              : undefined
          }
        >
          Delete…
        </Button>
        {testResult && (
          <Badge
            size="sm"
            color={testResult.ok ? 'green' : 'red'}
            variant="light"
          >
            {testResult.ok ? 'OK' : 'FAIL'} · {String(testResult.latency_ms)}ms
          </Badge>
        )}
      </Group>

      <Divider />

      {/* Models */}
      <ModelManager providerId={provider.id} />

      <Divider />

      {/* Agents using this provider */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Agents using this provider ({String(agentsUsing.length)})
        </Text>
        {agentsUsing.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No agents bound to this provider yet.
          </Text>
        ) : (
          <Group gap={6}>
            {agentsUsing.map((a) => (
              <Badge key={a.id} size="xs" variant="light" color="blue">
                {a.name} · {a.model}
              </Badge>
            ))}
          </Group>
        )}
      </Stack>

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this provider yet.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Action</Table.Th>
                <Table.Th>Actor</Table.Th>
                <Table.Th>When</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {auditTail.map((e) => (
                <Table.Tr key={e.id}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {e.action}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">{e.actor_id}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="xs">
                      {dayjs(e.at).format('MMM D, HH:mm:ss')}
                    </Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      {/* Rotate modal */}
      <Modal
        opened={rotateOpened}
        onClose={() => {
          closeRotate();
          setRotateValue('');
        }}
        title="Rotate credential"
        size="sm"
      >
        <Stack gap="md">
          <Text size="sm">
            Paste the new credential. Only the prefix will be stored for display.
          </Text>
          <PasswordInput
            value={rotateValue}
            onChange={(e) => {
              setRotateValue(e.currentTarget.value);
            }}
            placeholder="sk-…"
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeRotate();
                setRotateValue('');
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={rotating}
              disabled={rotateValue === ''}
              onClick={() => void handleRotate()}
            >
              Rotate
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete provider"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the provider. Agents still referencing it
            must be reassigned first.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {provider.name}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={provider.name}
            data-autofocus
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeDelete();
                setDeleteInput('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              size="sm"
              loading={deleting}
              disabled={deleteInput !== provider.name}
              onClick={() => void handleDelete()}
            >
              Delete permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
