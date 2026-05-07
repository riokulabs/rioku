/**
 * <BulkAttachModal> — multi-select agents × multi-select tools, then bulk
 * POST one binding per (agent, tool) pair to the daemon.
 *
 * The daemon's bulk-attach endpoint takes a single `agentId` plus a list
 * of `toolIds`, so we fan-out one daemon request per agent. The full
 * matrix collapses into the union of all (agent, tool) pairs the user
 * selected; existing bindings are skipped server-side, so this is
 * idempotent.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Group,
  Modal,
  MultiSelect,
  Stack,
  Text,
} from '@mantine/core';
import { IconAlertCircle, IconLink } from '@tabler/icons-react';
import { bulkAttachToolsToAgent, useInvalidateBindings } from '../api';
import { useAgentRefs, useToolRefs } from '../refs';

interface BulkAttachModalProps {
  tenantId: string;
  opened: boolean;
  onClose: () => void;
  /** Called after every fan-out request resolved (success or partial). */
  onComplete?: (summary: { attached: number; agents: number; tools: number }) => void;
}

export function BulkAttachModal({ tenantId, opened, onClose, onComplete }: BulkAttachModalProps) {
  const { list: agents } = useAgentRefs(tenantId);
  const { list: tools } = useToolRefs(tenantId);
  const invalidate = useInvalidateBindings(tenantId);

  const [selectedAgents, setSelectedAgents] = useState<string[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setSelectedAgents([]);
    setSelectedTools([]);
    setError(null);
  }

  async function handleSubmit() {
    if (selectedAgents.length === 0 || selectedTools.length === 0) return;
    setSubmitting(true);
    setError(null);
    let totalAttached = 0;
    try {
      for (const agentId of selectedAgents) {
        const result = await bulkAttachToolsToAgent(tenantId, agentId, selectedTools);
        totalAttached += result.length;
      }
      invalidate();
      onComplete?.({
        attached: totalAttached,
        agents: selectedAgents.length,
        tools: selectedTools.length,
      });
      reset();
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Bulk attach failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const agentOptions = agents.map((a) => ({ value: a.id, label: a.name }));
  const toolOptions = tools.map((t) => ({ value: t.id, label: t.name }));
  const planned = selectedAgents.length * selectedTools.length;

  return (
    <Modal
      opened={opened}
      onClose={() => {
        reset();
        onClose();
      }}
      title="Bulk attach tools to agents"
      size="lg"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="md">
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            {error}
          </Alert>
        )}

        <Text size="sm" c="var(--mantine-color-gray-7)">
          Select one or more agents and one or more tools. One binding will be created for every
          unique (agent, tool) pair. Existing bindings are skipped — this action is idempotent.
        </Text>

        <MultiSelect
          label="Agents"
          placeholder="Pick agents"
          data={agentOptions}
          value={selectedAgents}
          onChange={setSelectedAgents}
          searchable
          aria-label="Select agents to bulk-attach"
        />

        <MultiSelect
          label="Tools"
          placeholder="Pick tools"
          data={toolOptions}
          value={selectedTools}
          onChange={setSelectedTools}
          searchable
          aria-label="Select tools to bulk-attach"
        />

        <Text size="xs" c="var(--mantine-color-gray-7)" data-testid="bulk-attach-plan">
          Plan: create up to {String(planned)} binding{planned === 1 ? '' : 's'} (
          {String(selectedAgents.length)} agent{selectedAgents.length === 1 ? '' : 's'} ×{' '}
          {String(selectedTools.length)} tool{selectedTools.length === 1 ? '' : 's'}).
        </Text>

        <Group justify="flex-end" gap="sm">
          <Button
            variant="default"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            leftSection={<IconLink size={14} />}
            loading={submitting}
            disabled={selectedAgents.length === 0 || selectedTools.length === 0}
            onClick={() => void handleSubmit()}
          >
            Attach
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
