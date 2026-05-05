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
import { useMemo, useState } from 'react';
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
  PasswordInput,
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
  IconCheck,
  IconDotsVertical,
  IconLock,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { isFeatureEnabled } from '@/host/feature-flags';
import type { WebhookEndpoint } from '@/api/resources';
import {
  useWebhookEndpoints,
  addWebhookEndpoint,
  updateWebhookEndpoint,
  deleteWebhookEndpoint,
  useCurrentTenant,
} from '../api';
import { webhookEndpointSchema } from '../schemas';
import type { WebhookEndpointValues } from '../schemas';

// ─── OAuth connector card definitions ────────────────────────────────────────

interface OAuthProviderDef {
  name: string;
  slug: string;
  Icon: React.ComponentType<{ size?: number }>;
  testId: string;
  /** Default OAuth scopes to request. */
  defaultScopes: string;
}

const OAUTH_PROVIDERS: OAuthProviderDef[] = [
  {
    name: 'GitHub',
    slug: 'github',
    Icon: IconBrandGithub,
    testId: 'oauth-card-github',
    defaultScopes: 'read:user user:email',
  },
  {
    name: 'Google',
    slug: 'google',
    Icon: IconBrandGoogle,
    testId: 'oauth-card-google',
    defaultScopes: 'openid email profile',
  },
  {
    name: 'GitLab',
    slug: 'gitlab',
    Icon: IconBrandGitlab,
    testId: 'oauth-card-gitlab',
    defaultScopes: 'read_user openid email profile',
  },
  {
    name: 'Microsoft',
    slug: 'microsoft',
    Icon: IconBrandWindows,
    testId: 'oauth-card-microsoft',
    defaultScopes: 'openid email profile User.Read',
  },
];

interface OAuthConfig {
  enabled: boolean;
  client_id: string;
  client_secret: string;
  scopes: string;
  configured_at: string;
}

// ─── OAuth Configure modal ────────────────────────────────────────────────────

interface OAuthConfigureModalProps {
  provider: OAuthProviderDef;
  existing: OAuthConfig | undefined;
  callbackUrl: string;
  onClose: () => void;
  onSave: (slug: string, config: OAuthConfig) => void;
  onDelete: (slug: string) => void;
}

function OAuthConfigureModal({
  provider,
  existing,
  callbackUrl,
  onClose,
  onSave,
  onDelete,
}: OAuthConfigureModalProps) {
  const [clientId, setClientId] = useState(existing?.client_id ?? '');
  const [clientSecret, setClientSecret] = useState(existing?.client_secret ?? '');
  const [scopes, setScopes] = useState(existing?.scopes ?? provider.defaultScopes);
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [saving, setSaving] = useState(false);

  function handleSave() {
    if (clientId.trim().length === 0 || clientSecret.trim().length === 0) {
      notify.error('Missing fields', 'Client ID and secret are required.');
      return;
    }
    setSaving(true);
    onSave(provider.slug, {
      enabled,
      client_id: clientId.trim(),
      client_secret: clientSecret,
      scopes: scopes.trim(),
      configured_at: existing?.configured_at ?? new Date().toISOString(),
    });
    setSaving(false);
    onClose();
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={
        <Group gap="xs">
          <provider.Icon size={20} />
          <Text fw={600}>Configure {provider.name}</Text>
        </Group>
      }
      size="md"
      transitionProps={{ duration: 0 }}
      data-testid={`oauth-configure-modal-${provider.slug}`}
    >
      <Stack gap="sm">
        <Box>
          <Text size="sm" fw={500} mb={4}>
            Callback URL
          </Text>
          <Code block>{callbackUrl}</Code>
          <Text size="xs" c="var(--mantine-color-gray-7)" mt={4}>
            Add this redirect URI to your {provider.name} OAuth application.
          </Text>
        </Box>
        <TextInput
          label="Client ID"
          placeholder={`${provider.slug}-app-…`}
          value={clientId}
          onChange={(e) => {
            setClientId(e.currentTarget.value);
          }}
          required
          data-testid={`oauth-client-id-${provider.slug}`}
        />
        <PasswordInput
          label="Client secret"
          value={clientSecret}
          onChange={(e) => {
            setClientSecret(e.currentTarget.value);
          }}
          placeholder={existing ? '••••••••' : 'Paste your secret'}
          required
          data-testid={`oauth-client-secret-${provider.slug}`}
        />
        <TextInput
          label="Scopes"
          description="Space-separated OAuth scopes."
          value={scopes}
          onChange={(e) => {
            setScopes(e.currentTarget.value);
          }}
          data-testid={`oauth-scopes-${provider.slug}`}
        />
        <Switch
          label="Enabled"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.currentTarget.checked);
          }}
        />
        <Group justify="space-between" mt="sm">
          {existing ? (
            <Button
              variant="subtle"
              color="red"
              size="sm"
              leftSection={<IconTrash size={14} />}
              onClick={() => {
                onDelete(provider.slug);
                onClose();
              }}
            >
              Disconnect
            </Button>
          ) : (
            <span />
          )}
          <Group gap="xs">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
            <Button
              loading={saving}
              onClick={handleSave}
              data-testid={`oauth-save-${provider.slug}`}
            >
              {existing ? 'Save changes' : 'Connect'}
            </Button>
          </Group>
        </Group>
      </Stack>
    </Modal>
  );
}

// ─── OAuth connector card ─────────────────────────────────────────────────────

interface OAuthCardProps {
  provider: OAuthProviderDef;
  config: OAuthConfig | undefined;
  canWrite: boolean;
  onConfigure: () => void;
}

function OAuthCard({ provider, config, canWrite, onConfigure }: OAuthCardProps) {
  const { name, Icon, testId } = provider;
  const isConfigured = config !== undefined;
  return (
    <Card withBorder radius="md" p="md" data-testid={testId}>
      <Stack gap="sm" align="center">
        <Icon size={32} />
        <Text size="sm" fw={500}>
          {name}
        </Text>
        {isConfigured ? (
          <Badge
            size="sm"
            variant="light"
            color={config.enabled ? 'green' : 'gray'}
            leftSection={<IconCheck size={10} />}
          >
            {config.enabled ? 'Connected' : 'Disabled'}
          </Badge>
        ) : (
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Not configured
          </Text>
        )}
        <Tooltip label="Requires integrations:write permission" disabled={canWrite}>
          <span>
            <Button
              size="xs"
              variant={isConfigured ? 'default' : 'light'}
              disabled={!canWrite}
              onClick={onConfigure}
              data-testid={`oauth-configure-${name.toLowerCase()}`}
            >
              {isConfigured ? 'Edit' : 'Configure'}
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
      <form
        onSubmit={form.onSubmit((values) => {
          void handleSubmit(values);
        })}
      >
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
              <Text size="sm" fw={500} mb={4}>
                Secret
              </Text>
              <Code block data-testid="webhook-secret-display">
                {existing.secret}
              </Code>
              <Text size="xs" c="var(--mantine-color-gray-7)" mt={4}>
                Secret is set at creation and cannot be changed. Rotate by deleting and recreating
                the endpoint.
              </Text>
            </Box>
          )}
          <Switch
            label="Enabled"
            data-testid="webhook-enabled-switch"
            {...form.getInputProps('enabled', { type: 'checkbox' })}
          />
          <Group justify="flex-end" mt="sm">
            <Button variant="default" onClick={onClose}>
              Cancel
            </Button>
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
          Are you sure you want to delete <strong>{endpoint.name}</strong>? This cannot be undone.
        </Text>
        <Group justify="flex-end" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button
            color="red.8"
            loading={deleting}
            onClick={() => {
              void handleDelete();
            }}
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
                onClick={() => {
                  setCreateOpen(true);
                }}
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
                    <Text size="sm" fw={500}>
                      {ep.name}
                    </Text>
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
                          onClick={() => {
                            setEditEndpoint(ep);
                          }}
                          data-testid={`webhook-edit-${ep.id}`}
                        >
                          Edit
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<IconTrash size={14} />}
                          color="red"
                          onClick={() => {
                            setDeleteEndpoint(ep);
                          }}
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
        onClose={() => {
          setCreateOpen(false);
        }}
        tenantId={tenantId}
      />

      {editEndpoint != null && (
        <WebhookModal
          opened
          onClose={() => {
            setEditEndpoint(null);
          }}
          tenantId={tenantId}
          existing={editEndpoint}
        />
      )}

      <DeleteWebhookModal
        endpoint={deleteEndpoint}
        onClose={() => {
          setDeleteEndpoint(null);
        }}
      />
    </>
  );
}

// ─── Main section ─────────────────────────────────────────────────────────────

export function IntegrationsSection() {
  const canRead = usePermission('integrations:read');
  const canWrite = usePermission('integrations:write');
  const tenant = useCurrentTenant();
  const [oauthConfigs, setOauthConfigs] = useState<Record<string, OAuthConfig>>({});
  const [configuring, setConfiguring] = useState<OAuthProviderDef | null>(null);

  const callbackBase = useMemo(() => {
    if (typeof window === 'undefined') return 'https://your-domain.example/oauth/callback';
    return `${window.location.origin}/oauth/callback`;
  }, []);

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
      {/* OAuth connectors — hidden until `integrationsOAuth` feature flag is enabled */}
      {isFeatureEnabled('integrationsOAuth') && (
        <>
          <Stack gap="sm" data-testid="oauth-section">
            <Title order={5}>OAuth connectors</Title>
            <Text size="sm" c="var(--mantine-color-gray-7)">
              Connect external OAuth applications to enable SSO and delegated API access.
            </Text>
            <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="sm" data-testid="oauth-cards">
              {OAUTH_PROVIDERS.map((provider) => (
                <OAuthCard
                  key={provider.slug}
                  provider={provider}
                  config={oauthConfigs[provider.slug]}
                  canWrite={canWrite}
                  onConfigure={() => {
                    setConfiguring(provider);
                  }}
                />
              ))}
            </SimpleGrid>
          </Stack>

          <Divider />
        </>
      )}

      {configuring && (
        <OAuthConfigureModal
          provider={configuring}
          existing={oauthConfigs[configuring.slug]}
          callbackUrl={`${callbackBase}/${configuring.slug}`}
          onClose={() => {
            setConfiguring(null);
          }}
          onSave={(slug, cfg) => {
            setOauthConfigs((prev) => ({ ...prev, [slug]: cfg }));
            notify.success(
              `${configuring.name} ${oauthConfigs[slug] ? 'updated' : 'connected'}`,
              `${configuring.name} OAuth ${cfg.enabled ? 'enabled' : 'configured (disabled)'}.`,
            );
          }}
          onDelete={(slug) => {
            setOauthConfigs((prev) => {
              const next = { ...prev };
              Reflect.deleteProperty(next, slug);
              return next;
            });
            notify.success(
              `${configuring.name} disconnected`,
              `${configuring.name} OAuth credentials removed.`,
            );
          }}
        />
      )}

      {/* Inbound webhook endpoints */}
      <WebhookTable tenantId={tenant.id} canWrite={canWrite} />
    </Stack>
  );
}
