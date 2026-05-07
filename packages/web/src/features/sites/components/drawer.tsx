/**
 * <SiteDrawer> — quick-info drawer body for a single site, backed by the
 * real Orval-generated endpoints (see `useSiteDetailReal`,
 * `useDeleteSiteMutation`).
 *
 * Renders a compact summary (domain / TLS / enabled / linked-service) plus
 * two CTAs:
 *   1. "Open full page" — TanStack Router <Link> to /t/$tenant/sites/$siteId
 *      where the full <SiteFullPage> tabbed view lives.
 *   2. "Delete…" — opens a domain-typed confirmation Modal. The confirm
 *      button stays disabled until the user types the site's `domain`
 *      verbatim. On match, the real `useDeleteSiteMutation` fires.
 *
 * Used as the body of the right-side drawer in the sites list page.
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Divider,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link } from '@tanstack/react-router';
import { IconAlertCircle, IconExternalLink, IconWorld } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useSiteDetailReal, useDeleteSiteMutation } from '../api.stage2';

export interface SiteDrawerProps {
  tenantId: string;
  tenantSlug: string;
  siteId: string;
  onClose: () => void;
}

function tlsBadge(mode: string | undefined) {
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

export function SiteDrawer({ tenantId, tenantSlug, siteId, onClose }: SiteDrawerProps) {
  const site = useSiteDetailReal(tenantId, siteId);
  const deleteMutation = useDeleteSiteMutation(tenantId);

  const [confirmOpened, { open: openConfirm, close: closeConfirm }] = useDisclosure(false);
  const [typed, setTyped] = useState('');

  if (!site) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Site not found or still loading.
      </Alert>
    );
  }

  const expectedDomain = site.domain;
  const matches = typed === expectedDomain;

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync({
        id: siteId,
        typedDomainConfirm: typed,
        expectedDomain,
      });
      notify.success('Site deleted', `${expectedDomain} was removed.`);
      closeConfirm();
      setTyped('');
      onClose();
    } catch {
      notify.error('Failed to delete site', 'Please try again.');
    }
  }

  return (
    <Stack gap="md" data-testid="site-drawer">
      <Group gap="sm" wrap="nowrap">
        <IconWorld size={28} color="var(--mantine-color-blue-6)" />
        <Stack gap={2}>
          <Group gap="xs">
            <Title order={4} ff="monospace">
              {site.domain}
            </Title>
            {tlsBadge(site.tls_mode)}
            {site.enabled ? (
              <Badge size="sm" color="blue" variant="light">
                enabled
              </Badge>
            ) : (
              <Badge size="sm" color="gray" variant="outline">
                disabled
              </Badge>
            )}
          </Group>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            {site.name}
          </Text>
        </Stack>
      </Group>

      <Divider />

      <Stack gap={4}>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Linked service
        </Text>
        <Text size="sm" ff="monospace">
          {site.upstream_service_id ?? '—'}
        </Text>
      </Stack>

      <Stack gap={4}>
        <Text size="xs" c="var(--mantine-color-gray-7)">
          Rate limit preset
        </Text>
        <Text size="sm">{site.rate_limit_preset}</Text>
      </Stack>

      <Divider />

      <Group gap="sm">
        <Button
          size="sm"
          leftSection={<IconExternalLink size={14} />}
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment -- TanStack Link + Mantine polymorphic props require a cast
          component={Link as any}
          to="/t/$tenant/sites_/$siteId"
          params={{ tenant: tenantSlug, siteId }}
          data-testid="open-full-page"
        >
          Open full page
        </Button>
        <Button
          size="sm"
          variant="subtle"
          color="red.8"
          onClick={openConfirm}
          data-testid="drawer-delete"
        >
          Delete…
        </Button>
      </Group>

      <Modal
        opened={confirmOpened}
        onClose={() => {
          closeConfirm();
          setTyped('');
        }}
        title="Delete site"
        size="sm"
        transitionProps={{ duration: 0 }}
      >
        <Stack gap="md">
          <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
            This permanently deletes the site. Traffic to this domain will stop.
          </Alert>
          <Text size="sm">
            Type{' '}
            <Text component="span" fw={600} ff="monospace">
              {expectedDomain}
            </Text>{' '}
            to confirm.
          </Text>
          <TextInput
            value={typed}
            onChange={(e) => {
              setTyped(e.currentTarget.value);
            }}
            placeholder={expectedDomain}
            data-autofocus
            aria-label="Confirm site domain"
          />
          <Group justify="flex-end" gap="sm">
            <Button
              variant="default"
              size="sm"
              onClick={() => {
                closeConfirm();
                setTyped('');
              }}
            >
              Cancel
            </Button>
            <Button
              color="red.8"
              size="sm"
              loading={deleteMutation.isPending}
              disabled={!matches}
              onClick={() => void handleDelete()}
              data-testid="drawer-delete-confirm"
            >
              Delete permanently
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
