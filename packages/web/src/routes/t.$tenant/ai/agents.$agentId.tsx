/**
 * Per-agent detail page — /t/$tenant/ai/agents/$agentId
 *
 * Renders the four-tab <AgentFullPage>. Permission guard: ai-agent:read.
 */
import { createFileRoute, useNavigate, Link } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { AgentFullPage } from '@/features/ai-agents';

function AgentFullPageRoute() {
  const { tenant, agentId } = Route.useParams();
  const navigate = useNavigate();

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/agents"
          params={{ tenant }}
        >
          Back to agents
        </Button>
      </Group>
      <AgentFullPage
        tenant={tenant}
        agentId={agentId}
        onDeleted={() => {
          void navigate({
            to: '/t/$tenant/ai/agents',
            params: { tenant },
          } as unknown as Parameters<typeof navigate>[0]);
        }}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/agents/$agentId')({
  beforeLoad: requirePermissions({ required: ['ai-agent:read'] }),
  component: AgentFullPageRoute,
});
