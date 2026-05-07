/**
 * Per-rate-limit full-page detail — /t/$tenant/ai/rate-limits/$limitId
 *
 * Renders <RateLimitFullPage> with tabs: Configuration / Simulate /
 * Metrics / Audit. Used as the deep-link target from the rate-limit
 * drawer's "Open full page" button.
 */
import { createFileRoute, Link } from '@tanstack/react-router';
import { Button, Group, Stack } from '@mantine/core';
import { IconArrowLeft } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import { RateLimitFullPage } from '@/features/ai-rate-limits/components/full-page';

function RateLimitDetailPage() {
  const { tenant, limitId } = Route.useParams();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';
  const tenantSlug = tenantRecord?.slug ?? tenant;

  return (
    <Stack gap="md" p="md">
      <Group>
        <Button
          variant="subtle"
          size="xs"
          leftSection={<IconArrowLeft size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          component={Link as any}
          to="/t/$tenant/ai/rate-limits"
          params={{ tenant: tenantSlug }}
        >
          Back to rate limits
        </Button>
      </Group>
      <RateLimitFullPage ruleId={limitId} tenantId={tenantId} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/ai/rate-limits/$limitId')({
  beforeLoad: requirePermissions({ required: ['ai-rate-limit:read'] }),
  component: RateLimitDetailPage,
});
