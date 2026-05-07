/**
 * /t/$tenant/plugins/marketplace — Plan 09 T4.
 *
 * Standalone marketplace browse view that pulls the curated catalog
 * via `useMarketplaceListings` and renders the `<MarketplaceGrid>`.
 * The Install button on each card POSTs to
 * `/plugins/install-from-marketplace` and surfaces a notification
 * with the daemon's install id when accepted.
 */
import { useCallback } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Anchor, Breadcrumbs, Stack, Title, Text } from '@mantine/core';
import { requirePermissions } from '@/hooks/use-before-load';
import { notify } from '@/hooks/use-notify';
import { useMockStore } from '@/api/mock-store';
import {
  MarketplaceGrid,
  useInstallFromMarketplaceMutation,
} from '@/features/plugins/marketplace';
import type { MarketplaceListing } from '@/features/plugins/marketplace';

function MarketplaceBrowsePage() {
  const { tenant } = Route.useParams();
  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? tenant;
  const tenantSlug = tenantRecord?.slug ?? tenant;
  const installMutation = useInstallFromMarketplaceMutation(tenantId);

  const handleInstall = useCallback(
    (listing: MarketplaceListing) => {
      installMutation.mutate(
        { marketplaceId: listing.id, version: listing.version },
        {
          onSuccess: (resp) => {
            notify.success(
              'Install queued',
              `${listing.display_name} install id: ${resp.installId}`,
            );
          },
          onError: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Install request failed';
            notify.error('Install failed', msg);
          },
        },
      );
    },
    [installMutation],
  );

  return (
    <Stack gap="md" p="md">
      <Breadcrumbs>
        {/* eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment */}
        <Anchor component={Link as any} to="/t/$tenant/plugins" params={{ tenant: tenantSlug }}>
          Plugins
        </Anchor>
        <span>Marketplace</span>
      </Breadcrumbs>
      <Title order={2}>Plugin marketplace</Title>
      <Text c="dimmed" size="sm">
        Browse the curated catalog of first-party and verified third-party plugins.
        Click <strong>Install</strong> to fetch and stage a plugin via the daemon&apos;s
        install pipeline.
      </Text>
      <MarketplaceGrid onInstall={handleInstall} tenantSlug={tenantId} />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/plugins_/marketplace')({
  beforeLoad: requirePermissions({ required: ['plugin:read'] }),
  component: MarketplaceBrowsePage,
});
