/**
 * <BindingDetail> — drawer content for an AI tool-routing binding.
 *
 * Sections:
 *   - Header (agent chip, tool chip, enabled switch, close)
 *   - CEL condition (read-only display + in-place editor with Preview)
 *   - Actions (Edit, Delete — typed-confirm)
 *   - Audit tail
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Textarea,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import {
  IconAlertCircle,
  IconEye,
  IconRouter,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import {
  deleteBinding,
  previewCondition,
  updateBinding,
  useBindingDetail,
} from '../api';
import type { PreviewConditionResult } from '../types';

dayjs.extend(relativeTime);

interface BindingDetailProps {
  bindingId: string;
  onEdit: () => void;
  onClose: () => void;
}

export function BindingDetail({
  bindingId,
  onEdit,
  onClose,
}: BindingDetailProps) {
  const binding = useBindingDetail(bindingId);
  const agents = useMockStore((s) => s.aiAgents);
  const tools = useMockStore((s) => s.aiTools);
  const auditEntries = useMockStore((s) => s.audit);

  const auditTail = useMemo(() => {
    if (!binding) return [];
    return auditEntries
      .filter(
        (e) =>
          e.resource_type === 'ai-tool-binding' && e.resource_id === binding.id,
      )
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, binding]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] =
    useDisclosure(false);
  const [deleteInput, setDeleteInput] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [conditionDraft, setConditionDraft] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewConditionResult | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [savingCondition, setSavingCondition] = useState(false);

  if (!binding) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Binding not found.
      </Alert>
    );
  }

  const agent = agents[binding.agent_id];
  const tool = tools[binding.tool_id];
  const deleteLabel = `${agent?.name ?? binding.agent_id} · ${tool?.name ?? binding.tool_id}`;

  async function handleToggle(enabled: boolean) {
    if (!binding) return;
    try {
      await updateBinding(binding.id, { enabled });
    } catch {
      notify.error('Failed to update binding', 'Please try again.');
    }
  }

  async function handlePreview(raw: string) {
    setPreviewing(true);
    setPreview(null);
    try {
      const result = await previewCondition(raw, {});
      setPreview(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Preview failed';
      setPreview({ parses: false, error: msg });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleSaveCondition() {
    if (!binding || conditionDraft === null) return;
    if (conditionDraft.trim() !== '') {
      const p = await previewCondition(conditionDraft, {});
      if (!p.parses) {
        notify.error('Invalid CEL', p.error ?? 'Parse failed');
        return;
      }
    }
    setSavingCondition(true);
    try {
      await updateBinding(binding.id, { condition: conditionDraft });
      notify.success('Condition saved', 'Binding updated.');
      setConditionDraft(null);
      setPreview(null);
    } catch {
      notify.error('Failed to save condition', 'Please try again.');
    } finally {
      setSavingCondition(false);
    }
  }

  async function handleDelete() {
    if (!binding) return;
    if (deleteInput !== deleteLabel) return;
    setDeleting(true);
    try {
      await deleteBinding(binding.id);
      notify.success('Binding deleted', 'Tool unlinked from agent.');
      closeDelete();
      onClose();
    } catch {
      notify.error('Failed to delete binding', 'Please try again.');
    } finally {
      setDeleting(false);
      setDeleteInput('');
    }
  }

  const editing = conditionDraft !== null;
  const draft = conditionDraft ?? binding.condition;

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconRouter size={28} color="var(--mantine-color-indigo-6)" />
          <Stack gap={2}>
            <Title order={4}>Tool binding</Title>
            <Group gap="xs">
              <Badge size="sm" variant="light" color="blue" ff="monospace">
                {agent?.name ?? binding.agent_id}
              </Badge>
              <Text size="sm" c="var(--mantine-color-gray-7)">
                →
              </Text>
              <Badge size="sm" variant="light" color="indigo" ff="monospace">
                {tool?.name ?? binding.tool_id}
              </Badge>
              <Switch
                size="sm"
                checked={binding.enabled}
                aria-label={`Toggle binding ${binding.id}`}
                onChange={(e) => {
                  void handleToggle(e.currentTarget.checked);
                }}
              />
            </Group>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* CEL condition */}
      <Stack gap="xs">
        <Group justify="space-between" align="center">
          <Text size="sm" fw={600}>
            CEL condition
          </Text>
          {!editing ? (
            <Button
              size="xs"
              variant="subtle"
              onClick={() => {
                setConditionDraft(binding.condition);
              }}
              type="button"
            >
              Edit
            </Button>
          ) : (
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                onClick={() => {
                  setConditionDraft(null);
                  setPreview(null);
                }}
                type="button"
                disabled={savingCondition}
              >
                Cancel
              </Button>
              <Button
                size="xs"
                loading={savingCondition}
                onClick={() => void handleSaveCondition()}
                type="button"
              >
                Save
              </Button>
            </Group>
          )}
        </Group>
        {editing ? (
          <Stack gap="xs">
            <Textarea
              value={draft}
              onChange={(e) => {
                setConditionDraft(e.currentTarget.value);
                setPreview(null);
              }}
              minRows={3}
              maxRows={8}
              placeholder='e.g. request.user.role == "admin"'
              aria-label="CEL condition editor"
            />
            <Group gap="sm">
              <Button
                size="xs"
                variant="light"
                leftSection={<IconEye size={14} />}
                loading={previewing}
                disabled={draft.trim() === ''}
                onClick={() => void handlePreview(draft)}
                type="button"
              >
                Preview
              </Button>
              {preview && (
                <Text
                  size="xs"
                  c={
                    preview.parses
                      ? 'var(--mantine-color-green-7)'
                      : 'var(--mantine-color-red-7)'
                  }
                >
                  {preview.parses
                    ? `Parses · sample evaluates ${preview.sample_result === true ? 'true' : 'false'}`
                    : `Syntax error: ${preview.error ?? 'unknown'}`}
                </Text>
              )}
            </Group>
          </Stack>
        ) : binding.condition.trim() === '' ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            (unconditional — always allow)
          </Text>
        ) : (
          <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
            {binding.condition}
          </Text>
        )}
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit full form
        </Button>
        <Button
          size="sm"
          variant="subtle"
          color="red"
          onClick={openDelete}
        >
          Delete…
        </Button>
      </Group>

      <Divider />

      {/* Audit tail */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Recent activity
        </Text>
        {auditTail.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No audit entries for this binding yet.
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

      {/* Delete modal */}
      <Modal
        opened={deleteOpened}
        onClose={() => {
          closeDelete();
          setDeleteInput('');
        }}
        title="Delete binding"
        size="sm"
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This unlinks the tool from the agent. Existing agent invocations
            will stop being able to call this tool.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {deleteLabel}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={deleteInput}
            onChange={(e) => {
              setDeleteInput(e.currentTarget.value);
            }}
            placeholder={deleteLabel}
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
              disabled={deleteInput !== deleteLabel}
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
