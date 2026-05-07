/**
 * Per-binding detail page — /t/$tenant/ai/tool-bindings/$bindingId
 *
 * Renders the four-tab <BindingFullPage> (Overview / CEL preview /
 * Bound tools / Audit). Permission guard: ai-tool:read.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { BindingFullPage } from '@/features/ai-tool-routing';

function ToolBindingFullPageRoute() {
  const { tenant, bindingId } = Route.useParams();

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/tool-routing"
          params={{ tenant }}
        >
          Back to tool routing
        </Button>
      </Group>
      <BindingFullPage tenantId={tenant} bindingId={bindingId} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/tool-bindings/$bindingId')({
  beforeLoad: requirePermissions({ required: ['ai-tool:read'] }),
  component: ToolBindingFullPageRoute,
});
