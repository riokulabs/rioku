/**
 * <DangerZoneSection> — settings danger-zone section.
 *
 * Three cards, tightly permission-gated:
 *   1. Hard reset tenant data — requires tenant:hard-reset
 *   2. Export all tenant data — requires tenant:export
 *   3. Delete tenant (super-admin only) — requires tenant:delete
 *
 * Each card:
 *   - Title + description
 *   - Danger-color (or primary-color for export) button
 *   - Disabled with Tooltip when permission is missing
 *
 * Task 8c.13
 */
import { useState } from 'react';
import {
  Button,
  Card,
  Stack,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { exportTenantJson, useCurrentTenant } from '../api';
import { HardResetModal } from './danger-zone-hard-reset-modal';
import { DeleteTenantModal } from './danger-zone-delete-tenant-modal';

// ─── Component ────────────────────────────────────────────────────────────────

export function DangerZoneSection() {
  const tenant = useCurrentTenant();
  const canHardReset = usePermission('tenant:hard-reset');
  const canExport = usePermission('tenant:export');
  const canDelete = usePermission('tenant:delete');

  const [hardResetOpen, setHardResetOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const navigate = useNavigate();

  if (!tenant) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="danger-zone-no-tenant">
        No active tenant.
      </Text>
    );
  }

  async function handleExport() {
    if (!tenant) return;
    setExporting(true);
    try {
      await exportTenantJson(tenant.id);
      notify.success('Export started', 'Your tenant data download has begun.');
    } catch (e) {
      notify.error('Export failed', (e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  function handleDeleted() {
    // The tenant is gone — navigate to the root.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call
    void (navigate as any)({ to: '/' });
  }

  return (
    <Stack gap="lg" data-testid="danger-zone-section">
      {/* ── Hard reset card ─────────────────────────────────────────────── */}
      <Card withBorder radius="md" p="md" data-testid="danger-zone-hard-reset-card">
        <Stack gap="sm">
          <div>
            <Title order={5} data-testid="danger-zone-hard-reset-title">
              Hard reset tenant data
            </Title>
            <Text size="sm" c="var(--mantine-color-gray-7)" mt={4} data-testid="danger-zone-hard-reset-description">
              Resets all data for the current tenant back to seed defaults.
              This cannot be undone.
            </Text>
          </div>
          <Tooltip
            label="You do not have permission to hard-reset tenant data"
            disabled={canHardReset}
          >
            <span>
              {/* color="red.8" pins to red.8 (#e03131) so white text meets
                  WCAG AA (4.5:1) regardless of primaryShade. Task 9a.1. */}
              <Button
                color="red.8"
                disabled={!canHardReset}
                onClick={() => { setHardResetOpen(true); }}
                data-testid="danger-zone-hard-reset-button"
              >
                Reset tenant data
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Card>

      {/* ── Export card ─────────────────────────────────────────────────── */}
      <Card withBorder radius="md" p="md" data-testid="danger-zone-export-card">
        <Stack gap="sm">
          <div>
            <Title order={5} data-testid="danger-zone-export-title">
              Export all tenant data
            </Title>
            <Text size="sm" c="var(--mantine-color-gray-7)" mt={4} data-testid="danger-zone-export-description">
              Downloads a JSON file containing all resources, audit log,
              notifications, and dashboards for this tenant.
            </Text>
          </div>
          <Tooltip
            label="You do not have permission to export tenant data"
            disabled={canExport}
          >
            <span>
              <Button
                loading={exporting}
                disabled={!canExport}
                onClick={() => { void handleExport(); }}
                data-testid="danger-zone-export-button"
              >
                Export tenant JSON
              </Button>
            </span>
          </Tooltip>
        </Stack>
      </Card>

      {/* ── Delete tenant card (super-admin only) ───────────────────────── */}
      {canDelete && (
        <Card
          withBorder
          radius="md"
          p="md"
          style={{ borderColor: 'var(--mantine-color-red-6)' }}
          data-testid="danger-zone-delete-card"
        >
          <Stack gap="sm">
            <div>
              <Title order={5} data-testid="danger-zone-delete-title">
                Delete tenant
              </Title>
              <Text size="sm" c="var(--mantine-color-gray-7)" mt={4} data-testid="danger-zone-delete-description">
                Permanently deletes the tenant and all associated resources.
                Super-admin only.
              </Text>
            </div>
            {/* color="red.8" pins to red.8 (#e03131) so white text meets
                WCAG AA (4.5:1) regardless of primaryShade. Task 9a.1. */}
            <Button
              color="red.8"
              onClick={() => { setDeleteOpen(true); }}
              data-testid="danger-zone-delete-button"
            >
              Delete tenant
            </Button>
          </Stack>
        </Card>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────── */}
      <HardResetModal
        opened={hardResetOpen}
        onClose={() => { setHardResetOpen(false); }}
        tenantId={tenant.id}
        tenantSlug={tenant.slug}
      />

      <DeleteTenantModal
        opened={deleteOpen}
        onClose={() => { setDeleteOpen(false); }}
        tenantId={tenant.id}
        tenantSlug={tenant.slug}
        onDeleted={handleDeleted}
      />
    </Stack>
  );
}
