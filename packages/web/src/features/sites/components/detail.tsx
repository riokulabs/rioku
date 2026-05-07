/**
 * <SiteDetail> — drawer content for a single site.
 *
 * Sections:
 *   - Header: name, domain, enabled Switch, TLS badge
 *   - Upstream: linked-service chip (→ service detail) / PEM preview / direct
 *   - Policies: basic_auth + rate_limit_preset
 *   - Redirect rules (read-only)
 *   - Actions: Edit, Advanced configuration (deep-link), Delete (typed-domain confirm)
 *   - Audit tail (last 10 entries for resource_type='site')
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconArrowRight, IconExternalLink, IconWorld } from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { Link } from '@tanstack/react-router';
import { useMockStore } from '@/api/mock-store';
import { notify } from '@/hooks/use-notify';
import { toggleSite, useSiteDetail } from '../api';
import { DeleteSiteModal } from './delete-site-modal';

dayjs.extend(relativeTime);

interface SiteDetailProps {
  siteId: string;
  tenantSlug: string;
  onEdit: () => void;
  onClose: () => void;
}

function tlsBadge(mode: 'auto' | 'manual' | 'off') {
  if (mode === 'auto') {
    return (
      <Badge size="sm" color="green" variant="light">
        TLS auto
      </Badge>
    );
  }
  if (mode === 'manual') {
    return (
      <Badge size="sm" color="teal" variant="light">
        TLS manual
      </Badge>
    );
  }
  return (
    <Badge size="sm" color="gray" variant="outline">
      TLS off
    </Badge>
  );
}

export function SiteDetail({ siteId, tenantSlug, onEdit, onClose }: SiteDetailProps) {
  const site = useSiteDetail(siteId);
  const services = useMockStore((s) => s.services);
  const auditEntries = useMockStore((s) => s.audit);

  const linkedService = site?.upstream_service_id ? services[site.upstream_service_id] : undefined;

  const auditTail = useMemo(() => {
    if (!site) return [];
    return auditEntries
      .filter((e) => e.resource_type === 'site' && e.resource_id === site.id)
      .slice()
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 10);
  }, [auditEntries, site]);

  const [deleteOpened, { open: openDelete, close: closeDelete }] = useDisclosure(false);
  const [toggling, setToggling] = useState(false);

  if (!site) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Site not found.
      </Alert>
    );
  }

  async function handleToggle(next: boolean) {
    if (!site) return;
    setToggling(true);
    try {
      await toggleSite(site.tenant_id, site.id, next);
      notify.success(
        next ? 'Site enabled' : 'Site disabled',
        `${site.domain} is now ${next ? 'serving traffic' : 'disabled'}.`,
      );
    } catch {
      notify.error('Failed to update site', 'Please try again.');
    } finally {
      setToggling(false);
    }
  }

  const hasLinkedService = site.upstream_service_id !== undefined;

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between" align="flex-start">
        <Group gap="sm" wrap="nowrap">
          <IconWorld size={28} color="var(--mantine-color-blue-6)" />
          <Stack gap={2}>
            <Group gap="xs">
              <Title order={4} ff="monospace">
                {site.domain}
              </Title>
              {tlsBadge(site.tls_mode)}
              <Switch
                size="sm"
                checked={site.enabled}
                disabled={toggling}
                onChange={(e) => {
                  void handleToggle(e.currentTarget.checked);
                }}
                aria-label={`Toggle ${site.domain}`}
              />
            </Group>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              {site.name}
            </Text>
          </Stack>
        </Group>
      </Group>

      <Divider />

      {/* Upstream */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Upstream
        </Text>
        {linkedService ? (
          <Group gap="xs">
            <Badge
              // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
              component={Link as any}
              to="/t/$tenant/services_/$serviceId"
              params={{ tenant: tenantSlug, serviceId: linkedService.id }}
              size="sm"
              variant="light"
              color="blue"
              style={{ cursor: 'pointer', textDecoration: 'none' }}
            >
              {linkedService.name}
            </Badge>
            <Text size="xs" ff="monospace" c="var(--mantine-color-gray-7)">
              {linkedService.upstream}
            </Text>
          </Group>
        ) : site.tls_mode === 'manual' && site.tls_manual_cert ? (
          <Stack gap={4}>
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Manual TLS certificate
            </Text>
            <Text size="xs" ff="monospace">
              cert: {site.tls_manual_cert.cert_pem_preview}…
            </Text>
            <Text size="xs" ff="monospace">
              key: {site.tls_manual_cert.key_pem_preview}…
            </Text>
          </Stack>
        ) : (
          <Text size="xs" c="var(--mantine-color-gray-7)" fs="italic">
            Points at a direct upstream (no linked service).
          </Text>
        )}
      </Stack>

      <Divider />

      {/* Policies */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Policies
        </Text>
        <Group gap="xs">
          <Badge size="sm" variant="light" color={site.basic_auth_enabled ? 'indigo' : 'gray'}>
            Basic auth: {site.basic_auth_enabled ? 'on' : 'off'}
          </Badge>
          <Badge size="sm" variant="light" color="orange">
            Rate limit: {site.rate_limit_preset}
          </Badge>
        </Group>
      </Stack>

      <Divider />

      {/* Redirect rules */}
      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Redirect rules ({String(site.redirect_rules.length)})
        </Text>
        {site.redirect_rules.length === 0 ? (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            No redirect rules.
          </Text>
        ) : (
          <Table striped highlightOnHover>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>From</Table.Th>
                <Table.Th>To</Table.Th>
                <Table.Th>Status</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {site.redirect_rules.map((rule, i) => (
                <Table.Tr key={`${rule.from}-${String(i)}`}>
                  <Table.Td>
                    <Text size="xs" ff="monospace">
                      {rule.from}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Group gap={4} wrap="nowrap">
                      <IconArrowRight size={12} />
                      <Text size="xs" ff="monospace">
                        {rule.to}
                      </Text>
                    </Group>
                  </Table.Td>
                  <Table.Td>
                    <Badge size="xs" variant="outline">
                      {String(rule.status)}
                    </Badge>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <Divider />

      {/* Actions */}
      <Group gap="sm">
        <Button size="sm" onClick={onEdit}>
          Edit
        </Button>
        {hasLinkedService && site.upstream_service_id ? (
          <Button
            size="sm"
            variant="light"
            leftSection={<IconExternalLink size={14} />}
            // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
            component={Link as any}
            to="/t/$tenant/services_/$serviceId"
            params={{
              tenant: tenantSlug,
              serviceId: site.upstream_service_id,
            }}
          >
            Advanced configuration
          </Button>
        ) : (
          <Tooltip
            label="No linked service — edit the site to link it to a service for advanced configuration."
            multiline
            w={260}
          >
            <Button
              size="sm"
              variant="light"
              leftSection={<IconExternalLink size={14} />}
              disabled
              data-testid="advanced-config-disabled"
            >
              Advanced configuration
            </Button>
          </Tooltip>
        )}
        <Button size="sm" variant="subtle" color="red.8" onClick={openDelete}>
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
            No audit entries for this site yet.
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
                    <Text size="xs">{dayjs(e.at).format('MMM D, HH:mm:ss')}</Text>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      {/* Delete modal */}
      <DeleteSiteModal
        opened={deleteOpened}
        site={deleteOpened ? site : null}
        onClose={closeDelete}
        onSuccess={() => {
          closeDelete();
          onClose();
        }}
      />
    </Stack>
  );
}
