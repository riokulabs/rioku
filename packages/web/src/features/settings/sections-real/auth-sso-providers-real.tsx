/**
 * Real-API SSO providers section — stage-2 plan 17b (#240).
 *
 * Per-tenant CRUD for OIDC providers wired to a tenant. Reads via
 * `useListSsoProviders`, mutates via `useCreateSsoProvider`,
 * `usePatchSsoProvider`, `useDeleteSsoProvider`. The runtime data-plane
 * OIDC plugin (#170) consumes the resulting rows; this surface is
 * admin-side only.
 *
 * `kind="saml"` is reserved as a forward-compatible enum value;
 * everything below is OIDC-specific.
 */
import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  PasswordInput,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
} from '@mantine/core';
import { IconPencil, IconPlus, IconTrash } from '@tabler/icons-react';
import {
  useCreateSsoProvider,
  useDeleteSsoProvider,
  useListSsoProviders,
  usePatchSsoProvider,
} from '@/api/generated/sso/sso';
import type { SsoProvider } from '@/api/generated/schemas/ssoProvider';
import { notify } from '@/hooks/use-notify';
import { unwrap } from './_unwrap';

interface AuthSsoProvidersRealSectionProps {
  tenant: string;
}

interface DraftFormState {
  name: string;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecretRef: string;
  oidcScopesText: string; // newline- or comma-separated; parsed on submit
  enabled: boolean;
}

const EMPTY_FORM: DraftFormState = {
  name: '',
  oidcIssuer: '',
  oidcClientId: '',
  oidcClientSecretRef: '',
  oidcScopesText: 'openid\nprofile\nemail',
  enabled: true,
};

function parseScopes(raw: string): string[] {
  return raw
    .split(/[\n,]/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function providerToForm(p: SsoProvider): DraftFormState {
  return {
    name: p.name ?? '',
    oidcIssuer: p.oidcIssuer ?? '',
    oidcClientId: p.oidcClientId ?? '',
    oidcClientSecretRef: p.oidcClientSecretRef ?? '',
    oidcScopesText: (p.oidcScopes ?? []).join('\n'),
    enabled: p.enabled ?? true,
  };
}

export function AuthSsoProvidersRealSection({ tenant }: AuthSsoProvidersRealSectionProps) {
  const list = useListSsoProviders(tenant);
  const create = useCreateSsoProvider();
  const patch = usePatchSsoProvider();
  const del = useDeleteSsoProvider();

  // Modal state: either creating, editing an existing provider, or closed.
  const [editing, setEditing] = useState<SsoProvider | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<DraftFormState>(EMPTY_FORM);
  const [pendingDelete, setPendingDelete] = useState<SsoProvider | null>(null);

  // The Orval response shape is wrapped; unwrap to the bare list payload.
  const data = unwrap<{ items?: SsoProvider[]; total?: number }>(list.data);
  const items = data?.items ?? [];

  function openCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
  }

  function openEdit(p: SsoProvider) {
    setForm(providerToForm(p));
    setCreating(false);
    setEditing(p);
  }

  function closeModal() {
    setCreating(false);
    setEditing(null);
  }

  async function submitCreate() {
    if (!form.name.trim() || !form.oidcIssuer.trim() || !form.oidcClientId.trim()) {
      notify.error(
        'Required fields missing',
        'Name, issuer URL, and client ID are all required for an OIDC provider.',
      );
      return;
    }
    try {
      await create.mutateAsync({
        tenant,
        data: {
          name: form.name.trim(),
          kind: 'oidc',
          oidcIssuer: form.oidcIssuer.trim(),
          oidcClientId: form.oidcClientId.trim(),
          ...(form.oidcClientSecretRef.trim()
            ? { oidcClientSecretRef: form.oidcClientSecretRef.trim() }
            : {}),
          oidcScopes: parseScopes(form.oidcScopesText),
          enabled: form.enabled,
        },
      });
      notify.success('SSO provider created');
      closeModal();
      await list.refetch();
    } catch (err) {
      notify.error('Create failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  async function submitEdit() {
    if (!editing?.id) return;
    try {
      await patch.mutateAsync({
        tenant,
        id: editing.id,
        data: {
          name: form.name.trim(),
          oidcIssuer: form.oidcIssuer.trim(),
          oidcClientId: form.oidcClientId.trim(),
          ...(form.oidcClientSecretRef.trim()
            ? { oidcClientSecretRef: form.oidcClientSecretRef.trim() }
            : {}),
          oidcScopes: parseScopes(form.oidcScopesText),
          enabled: form.enabled,
        },
      });
      notify.success('SSO provider updated');
      closeModal();
      await list.refetch();
    } catch (err) {
      notify.error('Update failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  async function confirmDelete() {
    if (!pendingDelete?.id) return;
    try {
      await del.mutateAsync({ tenant, id: pendingDelete.id });
      notify.success('SSO provider removed');
      setPendingDelete(null);
      await list.refetch();
    } catch (err) {
      notify.error('Delete failed', err instanceof Error ? err.message : 'Unknown');
    }
  }

  if (list.isLoading)
    return (
      <Stack align="center" py="xl" data-testid="sso-providers-real-loading">
        <Loader />
      </Stack>
    );
  if (list.isError)
    return (
      <Alert color="red" data-testid="sso-providers-real-error">
        Failed to load SSO providers: {(list.error as Error).message}
      </Alert>
    );

  const modalOpen = creating || editing !== null;

  return (
    <Stack gap="lg" data-testid="sso-providers-real-section">
      <Group justify="space-between" align="flex-end">
        <div>
          <Title order={5}>SSO providers</Title>
          <Text size="xs" c="dimmed">
            Wire OIDC identity providers to this tenant. Sensitive client secrets are stored via
            secret references; the raw secret never traverses this surface.
          </Text>
        </div>
        <Button
          leftSection={<IconPlus size={14} />}
          size="xs"
          onClick={openCreate}
          data-testid="sso-providers-real-add"
        >
          Add provider
        </Button>
      </Group>

      {items.length === 0 ? (
        <Text size="sm" c="dimmed" data-testid="sso-providers-real-empty">
          No SSO providers configured.
        </Text>
      ) : (
        <Stack gap="xs">
          {items.map((p) => {
            const id = p.id ?? '';
            return (
              <Card key={id} withBorder data-testid={`sso-providers-real-row-${id}`}>
                <Group justify="space-between" wrap="nowrap">
                  <Stack gap={2}>
                    <Group gap="xs">
                      <Text fw={600} size="sm">
                        {p.name}
                      </Text>
                      <Badge variant="light" size="xs">
                        {p.kind ?? 'oidc'}
                      </Badge>
                      {p.enabled ? (
                        <Badge color="green" variant="light" size="xs">
                          Enabled
                        </Badge>
                      ) : (
                        <Badge color="gray" variant="outline" size="xs">
                          Disabled
                        </Badge>
                      )}
                    </Group>
                    {p.oidcIssuer && (
                      <Text size="xs" c="dimmed">
                        Issuer: {p.oidcIssuer}
                      </Text>
                    )}
                    {p.oidcClientId && (
                      <Text size="xs" c="dimmed">
                        Client ID: {p.oidcClientId}
                      </Text>
                    )}
                  </Stack>
                  <Group gap="xs">
                    <ActionIcon
                      variant="subtle"
                      onClick={() => {
                        openEdit(p);
                      }}
                      data-testid={`sso-providers-real-edit-${id}`}
                      aria-label="Edit"
                    >
                      <IconPencil size={14} />
                    </ActionIcon>
                    <ActionIcon
                      color="red"
                      variant="subtle"
                      onClick={() => {
                        setPendingDelete(p);
                      }}
                      data-testid={`sso-providers-real-delete-${id}`}
                      aria-label="Delete"
                    >
                      <IconTrash size={14} />
                    </ActionIcon>
                  </Group>
                </Group>
              </Card>
            );
          })}
        </Stack>
      )}

      <Text size="xs" c="dimmed">
        Audit emitted server-side on every create / update / delete.
      </Text>

      {/* Create/edit modal */}
      <Modal
        opened={modalOpen}
        onClose={closeModal}
        title={creating ? 'Add OIDC provider' : 'Edit OIDC provider'}
        size="lg"
        data-testid="sso-providers-real-modal"
      >
        <Stack gap="sm">
          <TextInput
            label="Name"
            description="Display name shown in this admin panel."
            value={form.name}
            onChange={(e) => {
              setForm({ ...form, name: e.currentTarget.value });
            }}
            data-testid="sso-providers-real-form-name"
            required
          />
          <TextInput
            label="OIDC issuer URL"
            description="Discovery endpoint base — e.g. https://your-org.okta.com"
            value={form.oidcIssuer}
            onChange={(e) => {
              setForm({ ...form, oidcIssuer: e.currentTarget.value });
            }}
            data-testid="sso-providers-real-form-issuer"
            required
          />
          <TextInput
            label="Client ID"
            value={form.oidcClientId}
            onChange={(e) => {
              setForm({ ...form, oidcClientId: e.currentTarget.value });
            }}
            data-testid="sso-providers-real-form-client-id"
            required
          />
          <PasswordInput
            label="Client secret reference"
            description="Reference into the secret store (#169) — not the secret itself."
            value={form.oidcClientSecretRef}
            onChange={(e) => {
              setForm({ ...form, oidcClientSecretRef: e.currentTarget.value });
            }}
            data-testid="sso-providers-real-form-secret-ref"
          />
          <Textarea
            label="OIDC scopes"
            description="One per line, or comma-separated."
            value={form.oidcScopesText}
            onChange={(e) => {
              setForm({ ...form, oidcScopesText: e.currentTarget.value });
            }}
            data-testid="sso-providers-real-form-scopes"
            minRows={3}
          />
          <Switch
            label="Enabled"
            checked={form.enabled}
            onChange={(e) => {
              setForm({ ...form, enabled: e.currentTarget.checked });
            }}
            data-testid="sso-providers-real-form-enabled"
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={closeModal}>
              Cancel
            </Button>
            <Button
              loading={create.isPending || patch.isPending}
              onClick={() => {
                if (creating) {
                  void submitCreate();
                } else {
                  void submitEdit();
                }
              }}
              data-testid="sso-providers-real-form-submit"
            >
              {creating ? 'Create' : 'Save'}
            </Button>
          </Group>
        </Stack>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        opened={pendingDelete !== null}
        onClose={() => {
          setPendingDelete(null);
        }}
        title="Remove SSO provider"
        size="sm"
        data-testid="sso-providers-real-delete-modal"
      >
        <Stack gap="sm">
          <Text size="sm">
            Remove provider <strong>{pendingDelete?.name}</strong>? Existing sessions are not
            invalidated, but no new sign-ins through this provider will succeed.
          </Text>
          <Group justify="flex-end">
            <Button
              variant="default"
              onClick={() => {
                setPendingDelete(null);
              }}
            >
              Cancel
            </Button>
            <Button
              color="red"
              loading={del.isPending}
              onClick={() => {
                void confirmDelete();
              }}
              data-testid="sso-providers-real-delete-confirm"
            >
              Remove
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
