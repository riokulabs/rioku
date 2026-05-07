/**
 * Plugins page — /t/$tenant/plugins
 *
 * Three tabs (Installed | Marketplace | Install by reference) with URL-synced
 * `tab` search param. Install flows all funnel through the shared
 * InstallApprovalModal. Installed-tab detail opens a Drawer.
 *
 * Guard: plugin:read (defined in host/permissions.ts). Install actions
 * additionally require plugin:install — the Install buttons in each tab
 * assume the current user has it (enforced end-to-end in stage 2).
 */
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Button, Group, Stack, Tabs, Title, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconLink, IconPlug, IconShieldCheck, IconShoppingBag } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { usePermission } from '@/hooks/use-permission';
import { requirePermissions } from '@/hooks/use-before-load';
import {
  InstalledPluginList,
  InstalledPluginDetail,
  UninstallPluginModal,
} from '@/features/plugins/installed';
import { MarketplaceGrid } from '@/features/plugins/marketplace';
import { InstallByReferenceForms } from '@/features/plugins/install-by-reference';
import { InstallApprovalModal, InstallProgressModal } from '@/features/plugins/install-approval';
import type {
  Plugin,
  MarketplaceListing,
  InstallCandidate,
  ApprovalCandidate,
} from '@/features/plugins';

type TabValue = 'installed' | 'marketplace' | 'install-by-reference';

const VALID_TABS: readonly TabValue[] = [
  'installed',
  'marketplace',
  'install-by-reference',
] as const;

function isValidTab(v: unknown): v is TabValue {
  return typeof v === 'string' && (VALID_TABS as readonly string[]).includes(v);
}

function listingToApproval(listing: MarketplaceListing): ApprovalCandidate {
  return {
    slug: listing.slug,
    display_name: listing.display_name,
    version: listing.version,
    signer: listing.verified ? listing.author : `${listing.author} (unverified)`,
    // Marketplace listings don't carry permissions in the mock; infer a
    // sensible default based on the slug namespace.
    declared_permissions: [`${listing.slug}:read`, `${listing.slug}:write`],
    parts: ['daemon', 'admin'],
    reference: `marketplace:${listing.slug}`,
    manifest: { slug: listing.slug, zones: [], api_scopes: [] },
  };
}

function candidateToApproval(candidate: InstallCandidate): ApprovalCandidate {
  return {
    slug: candidate.slug,
    display_name: candidate.display_name,
    version: candidate.version,
    parts: candidate.parts,
    declared_permissions: candidate.declared_permissions,
    reference: candidate.reference,
    ...(candidate.signer !== undefined ? { signer: candidate.signer } : {}),
    ...(candidate.manifest !== undefined ? { manifest: candidate.manifest } : {}),
  };
}

function PluginsPage() {
  const { tenant } = Route.useParams();
  const navigate = useNavigate();
  const search = Route.useSearch();

  const tenantId = tenant;
  const tenantSlug = tenant;

  const canReadSigners = usePermission('plugin-signer:read');

  const activeTab: TabValue = isValidTab(search.tab) ? search.tab : 'installed';

  function handleTabChange(next: string | null) {
    void navigate({
      to: '/t/$tenant/plugins',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        tab: next !== null && isValidTab(next) ? next : undefined,
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  // Installed detail drawer
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [selectedPlugin, setSelectedPlugin] = useState<Plugin | null>(null);

  function handleRowClick(plugin: Plugin) {
    setSelectedPlugin(plugin);
    openDrawer();
  }

  // Uninstall modal
  const [uninstallOpened, { open: openUninstall, close: closeUninstall }] = useDisclosure(false);
  const [uninstallTarget, setUninstallTarget] = useState<Plugin | null>(null);

  function handleUninstallRequest(plugin: Plugin) {
    setUninstallTarget(plugin);
    openUninstall();
  }

  function handleUninstallSuccess() {
    closeUninstall();
    // Close drawer if it was showing the uninstalled plugin
    if (selectedPlugin?.id === uninstallTarget?.id) {
      closeDrawer();
      setSelectedPlugin(null);
    }
    setUninstallTarget(null);
  }

  // Approval modal
  const [approvalOpened, { open: openApproval, close: closeApproval }] = useDisclosure(false);
  const [approvalCandidate, setApprovalCandidate] = useState<ApprovalCandidate | null>(null);

  // Install-progress modal (streaming) — opened after approval is granted.
  const [progressOpened, { open: openProgress, close: closeProgress }] = useDisclosure(false);
  const [progressCandidate, setProgressCandidate] = useState<ApprovalCandidate | null>(null);

  function handleMarketplaceInstall(listing: MarketplaceListing) {
    setApprovalCandidate(listingToApproval(listing));
    openApproval();
  }

  function handleByReferenceInstall(candidate: InstallCandidate) {
    setApprovalCandidate(candidateToApproval(candidate));
    openApproval();
  }

  /**
   * Streaming approval → progress handoff.
   *
   * The approval modal is in `streaming` mode, so on Approve it hands the
   * candidate back instead of installing synchronously. We close the approval
   * modal, stash the candidate, and open the progress modal which kicks off
   * installPluginWithProgress() internally.
   */
  function handleApprovalApprove(_plugin: Plugin | null, candidate: ApprovalCandidate) {
    closeApproval();
    setApprovalCandidate(null);
    setProgressCandidate(candidate);
    openProgress();
  }

  function handleApprovalCancel() {
    closeApproval();
    setApprovalCandidate(null);
  }

  function handleProgressComplete(_pluginId: string) {
    closeProgress();
    setProgressCandidate(null);
    // Switch to Installed tab after a successful install for visibility.
    void navigate({
      to: '/t/$tenant/plugins',
      params: { tenant: tenantSlug },
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        tab: 'installed',
      }),
      replace: true,
    } as unknown as Parameters<typeof navigate>[0]);
  }

  function handleProgressClose() {
    closeProgress();
    setProgressCandidate(null);
  }

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Plugins</Title>
        {canReadSigners && (
          <Button
            variant="subtle"
            leftSection={<IconShieldCheck size={16} />}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
            component={Link as any}
            to="/t/$tenant/plugins/signers"
            params={{ tenant: tenantSlug }}
            data-testid="plugins-signers-link"
          >
            Signer allow-list
          </Button>
        )}
      </Group>

      <Tabs value={activeTab} onChange={handleTabChange} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="installed" leftSection={<IconPlug size={14} />}>
            Installed
          </Tabs.Tab>
          <Tabs.Tab value="marketplace" leftSection={<IconShoppingBag size={14} />}>
            Marketplace
          </Tabs.Tab>
          <Tabs.Tab value="install-by-reference" leftSection={<IconLink size={14} />}>
            Install by reference
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="installed" pt="md">
          <InstalledPluginList
            tenantId={tenantId}
            onSelect={handleRowClick}
            onUninstall={handleUninstallRequest}
          />
        </Tabs.Panel>

        <Tabs.Panel value="marketplace" pt="md">
          <MarketplaceGrid onInstall={handleMarketplaceInstall} tenantSlug={tenantId} />
        </Tabs.Panel>

        <Tabs.Panel value="install-by-reference" pt="md">
          <InstallByReferenceForms onRequestApproval={handleByReferenceInstall} />
        </Tabs.Panel>
      </Tabs>

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={selectedPlugin ? selectedPlugin.display_name : 'Plugin detail'}
        position="right"
        size="min(520px, 95vw)"
        padding="md"
      >
        {selectedPlugin && (
          <InstalledPluginDetail
            pluginId={selectedPlugin.id}
            tenantSlug={tenantSlug}
            onClose={() => {
              closeDrawer();
              setSelectedPlugin(null);
            }}
            onUninstall={() => {
              handleUninstallRequest(selectedPlugin);
            }}
          />
        )}
      </Drawer>

      <UninstallPluginModal
        plugin={uninstallTarget}
        opened={uninstallOpened}
        tenantId={tenantId}
        onClose={() => {
          closeUninstall();
          setUninstallTarget(null);
        }}
        onSuccess={handleUninstallSuccess}
      />

      <InstallApprovalModal
        tenantId={tenantId}
        candidate={approvalCandidate}
        opened={approvalOpened}
        streaming
        onApprove={handleApprovalApprove}
        onCancel={handleApprovalCancel}
      />

      <InstallProgressModal
        candidate={progressCandidate}
        opened={progressOpened}
        tenantSlug={tenantId}
        onComplete={handleProgressComplete}
        onClose={handleProgressClose}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/plugins')({
  beforeLoad: requirePermissions({ required: ['plugin:read'] }),
  component: PluginsPage,
  validateSearch: (search: Record<string, unknown>) => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
    q: typeof search.q === 'string' ? search.q : undefined,
    tags:
      typeof search.tags === 'string'
        ? search.tags
        : Array.isArray(search.tags)
          ? search.tags.filter((t): t is string => typeof t === 'string')
          : undefined,
    f: typeof search.f === 'string' ? search.f : undefined,
    // Marketplace polish (Plan 6): category sidebar + sort + verified toggle.
    verified: search.verified === 'true' || search.verified === true ? 'true' : undefined,
    sort: typeof search.sort === 'string' ? search.sort : undefined,
  }),
});
