/**
 * AI Tool full-page detail — /t/$tenant/ai/tools/$toolId
 *
 * Renders the Definition / Test invocation / Audit tab surface defined in
 * `<ToolFullPage>`. Active tab is URL-synced via the `tab` search param.
 *
 * Permission guard: ai-tool:read.
 */
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { ToolFullPage } from '@/features/ai-tools';

type ToolTab = 'definition' | 'invoke' | 'audit';

interface SearchParams {
  tab: ToolTab;
}

function ToolDetailPage() {
  const { tenant, toolId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();

  function handleTabChange(next: ToolTab) {
    void navigate({
      to: '/t/$tenant/ai/tools/$toolId',
      params: { tenant, toolId },
      search: { tab: next },
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  function handleDeleted() {
    void navigate({
      to: '/t/$tenant/ai/tools',
      params: { tenant },
    } as unknown as Parameters<typeof navigate>[0]);
  }

  return (
    <Stack gap="md" p="md">
      <Group gap="xs">
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/ai/tools"
          params={{ tenant }}
        >
          Back to tools
        </Button>
      </Group>

      <ToolFullPage
        tenant={tenant}
        toolId={toolId}
        initialTab={search.tab}
        onTabChange={handleTabChange}
        onDeleted={handleDeleted}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/tools_/$toolId')({
  beforeLoad: requirePermissions({ required: ['ai-tool:read'] }),
  component: ToolDetailPage,
  validateSearch: (s: Record<string, unknown>): SearchParams => {
    const t = s.tab;
    return {
      tab: t === 'invoke' || t === 'audit' || t === 'definition' ? t : 'definition',
    };
  },
});
