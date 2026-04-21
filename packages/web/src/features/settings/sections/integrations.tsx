/**
 * <IntegrationsSection> — settings Integrations section.
 *
 * Stage-1 placeholder surface. Contains:
 *   1. Stage-1 note banner
 *   2. OAuth connectors — static placeholder cards (stage 2+)
 *   3. Inbound webhook endpoints — list + create/edit/delete backed by mock store
 *
 * Task 8c.11
 */
import { useState } from 'react';
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Group,
  Menu,
  Modal,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  TagsInput,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import {
  IconBrandGithub,
  IconBrandGitlab,
  IconBrandGoogle,
  IconBrandWindows,
  IconDotsVertical,
  IconInfoCircle,
  IconLock,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import type { WebhookEndpoint } from '@/api/resources/types';
import { useWebhookEndpoints, addWebhookEndpoint, updateWebhookEndpoint, deleteWebhookEndpoint, useCurrentTenant } from '../api';
import { webhookEndpointSchema } from '../schemas';
import type { WebhookEndpointValues } from '../schemas';

// ─── OAuth connector card definitions ────────────────────────────────────────

interface OAuthProvider {
  name: string;
  Icon: React.ComponentType<{ size?: number }>;
  testId: string;
}

const OAUTH_PROVIDERS: OAuthProvider[] = [
  { name: 'GitHub', Icon: IconBrandGithub, testId: 'oauth-card-github' },
  { name: 'Google', Icon: IconBrandGoogle, testId: 'oauth-card-google' },
  { name: 'GitLab', Icon: IconBrandGitlab, testId: 'oauth-card-gitlab' },
  { name: 'Microsoft', Icon: IconBrandWindows, testId: 'oauth-card-microsoft' },
];

// ─── OAuth connector card ─────────────────────────────────────────────────────

function OAuthCard({ provider }: { provider: OAuthProvider }) {
  const { name, Icon, testId } = provider;
  return (
    <Card withBorder radius="md" p="md" data-testid={testId}>
      <Stack gap="sm" align="center">
        <Icon size={32} />
        <Text size="sm" fw={500}>{name}</Text>
        <Text size="xs" c="var(--mantine-color-gray-7)">Not configured</Text>
        <Tooltip label="Coming at stage 2">
          <span>
            <Button
              size="xs"
              variant="light"
              disabled
              data-testid={`oauth-configure-${name.toLowerCase()}`}
            >
              Configure
            </Button>
          </span>
        </Tooltip>
      </Stack>
    </Card>
  );
}

// ─── Webhook create/edit modal ────────────────────────────────────────────────

interface WebhookModalProps {
  opened: boolean;
  onClose: () => void;
  tenantId: string;
  existing?: WebhookEndpoint;
}

function WebhookModal({ opened, onClose, tenantId, existing }: WebhookModalProps) {
  const [saving, setSaving] = useState(false);
  const isEdit = existing != null;

  const form = useForm<WebhookEndpointValues>({
    mode: 'controlled',
    initialValues: {
      name: existing?.name ?? '',
      path: existing?.path ?? '/webhooks/',
      expected_event_types: existing?.expected_event_types ?? [],
      enabled: existing?.enabled ?? true,
    },
    validate: schemaResolver(webhookEndpointSchema, { sync: true }),
  });

  async function handleSubmit(values: WebhookEndpointValues) {
    setSaving(true);
    try {
      if (existing != null) {
        await updateWebhookEndpoint(existing.id, values);
        notify.success('Webhook updated', `"${values.name}" has been updated.`);
      } else {
        await addWebhookEndpoint(tenantId, values);
        notify.success('Webhook created', `"${values.name}" has been created.`);
      }
      if (existing != null) {
        form.resetDirty(form.values);
      } else {
        form.reset();
      }
      onClose();
    } catch (e) {
      notify.error('Save failed', (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // duration=0 prevents JSDOM animation hangs in tests
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={isEdit ? 'Edit webhook endpoint' : 'Add webhook endpoint'}
      size="md"
      data-testid={isEdit ? 'edit-webhook-modal' : 'create-webhook-modal'}
      transitionProps={{ duration: 0 }}
    >
      <form onSubmit={form.onSubmit((values) => { void handleSubmit(values); })}>
        <Stack gap="sm">
          <TextInput
            label="Name"
            placeholder="GitHub events"
            required
            data-testid="webhook-name-input"
            {...form.getInputProps('name')}
          />
          <TextInput
            label="Path"
            description="Must start with /webhooks/"
            placeholder="/webhooks/github"
            required
            data-testid="webhook-path-input"
            {...form.getInputProps('path')}
          />
          <TagsInput
            label="Expected event types"
            description="Event type strings the upstream service will send (informational)"
            placeholder="push, pull_request, ..."
            data-testid="webhook-event-types-input"
            {...form.getInputProps('expected_event_types')}
          />
          {existing != null && (
            <Box>
              <Text size="sm" fw={500} mb={4}>Secret</Text>
              <Code block data-testid="webhook-secret-display">{existing.secret}</Code>
              <Text size="xs" c="var(--mantine-color-gray-7)" mt={4}>
                Secret is set at creation and cannot be changed. Rotate by deleting and recreating the endpoint.
              </Text>
            </Box>
          )}
          <Switch
            label="Enabled"
            data-testid="webhook-enabled-switch"
            {...form.getInputProps('enabled', { type: 'checkbox' })}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>Cancel</Button>
            <Button
              type="submit"
              loading={saving}
              data-testid={isEdit ? 'save-webhook-button' : 'create-webhook-button'}
            >
              {isEdit ? 'Save changes' : 'Create webhook'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

// ─── Delete confirm modal ─────────────────────────────────────────────────────

interface DeleteWebhookModalProps {
  endpoint: WebhookEndpoint | null;
  onClose: () => void;
}

function DeleteWebhookModal({ endpoint, onClose }: DeleteWebhookModalProps) {
  const [deleting, setDeleting] = useState(false);

  if (!endpoint) return null;

  async function handleDelete() {
    if (!endpoint) return;
    setDeleting(true);
    try {
      await deleteWebhookEndpoint(endpoint.id);
      notify.success('Webhook deleted', `"${endpoint.name}" has been removed.`);
      onClose();
    } catch (e) {
      notify.error('Delete failed', (e as Error).message);
    } finally {
      setDeleting(false);
    }
  }

  // duration=0 prevents JSDOM animation hangs in tests
  return (
    <Modal
      opened
      onClose={onClose}
      title="Delete webhook endpoint"
      size="sm"
      data-testid="delete-webhook-modal"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        <Text size="sm">
          Are you sure you want to delete{' '}
          <strong>{endpoint.name}</strong>? This cannot be undone.
        </Text>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>Cancel</Button>
          <Button
            color="red"
            loading={deleting}
            onClick={() => { void handleDelete(); }}
            data-testid="confirm-delete-webhook-button"
          >
            Delete
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── Webhook table ────────────────────────────────────────────────────────────

interface WebhookTableProps {
  tenantId: string;
  canWrite: boolean;
}

function WebhookTable({ tenantId, canWrite }: WebhookTableProps) {
  const endpoints = useWebhookEndpoints();
  const [createOpen, setCreateOpen] = useState(false);
  const [editEndpoint, setEditEndpoint] = useState<WebhookEndpoint | null>(null);
  const [deleteEndpoint, setDeleteEndpoint] = useState<WebhookEndpoint | null>(null);

  return (
    <>
      <Stack gap="sm" data-testid="webhook-table-section">
        <Group justify="space-between" align="center">
          <Title order={5}>Inbound webhook endpoints</Title>
          <Tooltip label="Requires integrations:write permission" disabled={canWrite}>
            <span>
              <Button
                size="sm"
                leftSection={!canWrite ? <IconLock size={14} /> : <IconPlus size={14} />}
                disabled={!canWrite}
                onClick={() => { setCreateOpen(true); }}
                data-testid="add-webhook-button"
              >
                Add webhook
              </Button>
            </span>
          </Tooltip>
        </Group>

        {endpoints.length === 0 ? (
          <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="webhook-empty-state">
            No webhook endpoints configured.
          </Text>
        ) : (
          <Table striped highlightOnHover data-testid="webhook-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Path</Table.Th>
                <Table.Th>Enabled</Table.Th>
                <Table.Th>Event types</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {endpoints.map((ep) => (
                <Table.Tr key={ep.id} data-testid={`webhook-row-${ep.id}`}>
                  <Table.Td>
                    <Text size="sm" fw={500}>{ep.name}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Code data-testid={`webhook-path-${ep.id}`}>{ep.path}</Code>
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      color={ep.enabled ? 'green' : 'gray'}
                      variant="light"
                      size="sm"
                      data-testid={`webhook-enabled-badge-${ep.id}`}
                    >
                      {ep.enabled ? 'enabled' : 'disabled'}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" c="var(--mantine-color-gray-7)">
                      {ep.expected_event_types.length === 0
                        ? '—'
                        : `${String(ep.expected_event_types.length)} type${ep.expected_event_types.length === 1 ? '' : 's'}`}
                    </Text>
                  </Table.Td>
                  <Table.Td>
                    <Menu withinPortal position="bottom-end">
                      <Menu.Target>
                        <Tooltip label="Requires integrations:write permission" disabled={canWrite}>
                          <span>
                            <Button
                              size="xs"
                              variant="subtle"
                              disabled={!canWrite}
                              px={6}
                              aria-label={`Webhook actions for ${ep.name}`}
                              data-testid={`webhook-actions-${ep.id}`}
                            >
                              <IconDotsVertical size={14} />
                            </Button>
                          </span>
                        </Tooltip>
                      </Menu.Target>
                      <Menu.Dropdown>
                        <Menu.Item
                          leftSection={<IconPencil size={14} />}
                          onClick={() => { setEditEndpoint(ep); }}
                          data-testid={`webhook-edit-${ep.id}`}
                        >
                          Edit
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconTrash size={14} />}
                          color="red"
                          onClick={() => { setDeleteEndpoint(ep); }}
                          data-testid={`webhook-delete-${ep.id}`}
                        >
                          Delete
                        </Menu.Item>
                      </Menu.Dropdown>
                    </Menu>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>

      <WebhookModal
        opened={createOpen}
        onClose={() => { setCreateOpen(false); }}
        tenantId={tenantId}
      />

      {editEndpoint != null && (
        <WebhookModal
          opened
          onClose={() => { setEditEndpoint(null); }}
          tenantId={tenantId}
          existing={editEndpoint}
        />
      )}

      <DeleteWebhookModal
        endpoint={deleteEndpoint}
        onClose={() => { setDeleteEndpoint(null); }}
      />
    </>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function IntegrationsSection() {
  const canRead = usePermission('integrations:read');
  const canWrite = usePermission('integrations:write');
  const tenant = useCurrentTenant();

  if (!canRead) {
    return (
      <Alert
        icon={<IconLock size={16} />}
        color="orange"
        variant="light"
        title="Access denied"
        data-testid="integrations-access-denied"
      >
        You need the <strong>integrations:read</strong> permission to view Integrations settings.
      </Alert>
    );
  }

  if (!tenant) return null;

  return (
    <Stack gap="xl" data-testid="integrations-section">
      {/* Stage-1 note banner */}
      <Alert
        icon={<IconInfoCircle size={16} />}
        color="blue"
        variant="light"
        title="Stage-1 placeholder"
        data-testid="integrations-stage1-banner"
      >
        Integrations surface is a placeholder for stage 2+. OAuth connectors are not yet
        functional. Webhook endpoint records are stored in the mock store but are not
        evaluated at runtime until stage 2.
      </Alert>

      {/* OAuth connectors */}
      <Stack gap="sm" data-testid="oauth-section">
        <Title order={5}>OAuth connectors</Title>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Connect external OAuth applications to enable SSO and delegated API access.
          Configuration is available at stage 2+.
        </Text>
        <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" data-testid="oauth-cards">
          {OAUTH_PROVIDERS.map((provider) => (
            <OAuthCard key={provider.name} provider={provider} />
          ))}
        </SimpleGrid>
      </Stack>

      <Divider />

      {/* Inbound webhook endpoints */}
      <WebhookTable tenantId={tenant.id} canWrite={canWrite} />
    </Stack>
  );
}
