/**
 * <SsoProviders> — list + add/edit OAuth and SAML SSO providers.
 *
 * Stage-1 mock: all configuration lives in component-local state. Stage-2
 * will persist via the daemon's auth-config endpoint. Two provider kinds:
 *   - oauth — issuer URL + client id/secret + scopes
 *   - saml  — metadata URL or pasted XML + attribute mapping
 *
 * Keeps the visual rhythm of the surrounding Authentication section (Title
 * order={5} + Stack), no Cards or Fieldsets.
 */
import { useMemo, useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCertificate,
  IconKey,
  IconPencil,
  IconPlus,
  IconTrash,
} from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { makeIdFactory } from '@/lib/id-generator';

export type SsoProviderKind = 'oauth' | 'saml';

export interface SsoProvider {
  id: string;
  kind: SsoProviderKind;
  name: string;
  enabled: boolean;
  /** OAuth-only. */
  issuer_url?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string;
  /** SAML-only. */
  metadata_url?: string;
  metadata_xml?: string;
  email_attribute?: string;
  name_attribute?: string;
  /** ISO timestamp. */
  created_at: string;
}

const nextId = makeIdFactory('sso');

interface SsoProvidersProps {
  canWrite: boolean;
}

export function SsoProviders({ canWrite }: SsoProvidersProps) {
  const [providers, setProviders] = useState<SsoProvider[]>([]);
  const [editing, setEditing] = useState<SsoProvider | null>(null);
  const [creating, setCreating] = useState<SsoProviderKind | null>(null);
  const [deleting, setDeleting] = useState<SsoProvider | null>(null);

  function handleSave(provider: SsoProvider) {
    setProviders((prev) => {
      const exists = prev.some((p) => p.id === provider.id);
      if (exists) return prev.map((p) => (p.id === provider.id ? provider : p));
      return [...prev, provider];
    });
    notify.success(
      `SSO provider ${editing ? 'updated' : 'added'}`,
      `${provider.name} (${provider.kind.toUpperCase()}) is ${provider.enabled ? 'enabled' : 'disabled'}.`,
    );
    setEditing(null);
    setCreating(null);
  }

  function handleDelete(id: string) {
    const target = providers.find((p) => p.id === id);
    setProviders((prev) => prev.filter((p) => p.id !== id));
    if (target) notify.success('SSO provider removed', `${target.name} disconnected.`);
    setDeleting(null);
  }

  function handleToggle(provider: SsoProvider, enabled: boolean) {
    setProviders((prev) => prev.map((p) => (p.id === provider.id ? { ...p, enabled } : p)));
  }

  return (
    <Stack gap="sm" data-testid="auth-sso-fieldset">
      <Group justify="space-between" align="center" wrap="wrap">
        <Title order={5}>SSO providers</Title>
        <Group gap="xs">
          <Tooltip label="Requires tenant-auth:write" disabled={canWrite}>
            <span>
              <Button
                size="xs"
                variant="default"
                leftSection={<IconKey size={14} />}
                disabled={!canWrite}
                onClick={() => {
                  setCreating('oauth');
                }}
                data-testid="sso-add-oauth"
              >
                Add OAuth
              </Button>
            </span>
          </Tooltip>
          <Tooltip label="Requires tenant-auth:write" disabled={canWrite}>
            <span>
              <Button
                size="xs"
                leftSection={<IconCertificate size={14} />}
                disabled={!canWrite}
                onClick={() => {
                  setCreating('saml');
                }}
                data-testid="sso-add-saml"
              >
                Add SAML
              </Button>
            </span>
          </Tooltip>
        </Group>
      </Group>
      <Text size="sm" c="var(--mantine-color-gray-7)">
        External identity providers users can sign in with. Standard OAuth 2.0 / OIDC and SAML 2.0
        supported.
      </Text>

      {providers.length === 0 ? (
        <Box
          p="md"
          ta="center"
          style={{
            border: '1px dashed var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Text size="sm" c="dimmed">
            No SSO providers configured. Use “Add OAuth” or “Add SAML” to connect one.
          </Text>
        </Box>
      ) : (
        <Stack gap="xs">
          {providers.map((p) => (
            <Group
              key={p.id}
              gap="md"
              wrap="nowrap"
              align="center"
              p="sm"
              style={{
                border: '1px solid var(--mantine-color-default-border)',
                borderRadius: 'var(--mantine-radius-md)',
              }}
            >
              <Box
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 6,
                  background: 'var(--mantine-color-default-hover)',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0,
                }}
              >
                {p.kind === 'oauth' ? <IconKey size={16} /> : <IconCertificate size={16} />}
              </Box>
              <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
                <Group gap="xs" wrap="nowrap">
                  <Text size="sm" fw={600} truncate>
                    {p.name}
                  </Text>
                  <Badge size="xs" variant="light" color="gray">
                    {p.kind.toUpperCase()}
                  </Badge>
                </Group>
                <Text size="xs" c="dimmed" truncate>
                  {p.kind === 'oauth'
                    ? (p.issuer_url ?? 'No issuer set')
                    : (p.metadata_url ?? 'Inline XML')}
                </Text>
              </Stack>
              <Switch
                checked={p.enabled}
                onChange={(e) => {
                  handleToggle(p, e.currentTarget.checked);
                }}
                disabled={!canWrite}
                aria-label={`${p.name} enabled`}
                size="sm"
              />
              <Group gap={4} wrap="nowrap">
                <Tooltip label="Edit" withArrow>
                  <ActionIcon
                    variant="subtle"
                    onClick={() => {
                      setEditing(p);
                    }}
                    disabled={!canWrite}
                    aria-label={`Edit ${p.name}`}
                  >
                    <IconPencil size={14} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Delete" withArrow>
                  <ActionIcon
                    variant="subtle"
                    color="red"
                    onClick={() => {
                      setDeleting(p);
                    }}
                    disabled={!canWrite}
                    aria-label={`Delete ${p.name}`}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </Group>
          ))}
        </Stack>
      )}

      {(creating !== null || editing !== null) && (
        <SsoProviderModal
          kind={editing ? editing.kind : (creating ?? 'oauth')}
          {...(editing ? { existing: editing } : {})}
          onClose={() => {
            setEditing(null);
            setCreating(null);
          }}
          onSave={handleSave}
        />
      )}

      {deleting && (
        <Modal
          opened
          onClose={() => {
            setDeleting(null);
          }}
          title="Remove SSO provider?"
          size="sm"
          transitionProps={{ duration: 0 }}
        >
          <Stack gap="md">
            <Text size="sm">
              Users currently signed in via <strong>{deleting.name}</strong> will keep their
              session, but will not be able to start new sign-ins through this provider.
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setDeleting(null);
                }}
              >
                Cancel
              </Button>
              <Button
                color="red"
                onClick={() => {
                  handleDelete(deleting.id);
                }}
              >
                Remove
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}

interface SsoProviderModalProps {
  kind: SsoProviderKind;
  existing?: SsoProvider;
  onClose: () => void;
  onSave: (provider: SsoProvider) => void;
}

function SsoProviderModal({ kind: initialKind, existing, onClose, onSave }: SsoProviderModalProps) {
  const [kind, setKind] = useState<SsoProviderKind>(initialKind);
  const [name, setName] = useState(existing?.name ?? '');
  const [enabled, setEnabled] = useState(existing?.enabled ?? true);
  const [issuerUrl, setIssuerUrl] = useState(existing?.issuer_url ?? '');
  const [clientId, setClientId] = useState(existing?.client_id ?? '');
  const [clientSecret, setClientSecret] = useState(existing?.client_secret ?? '');
  const [scopes, setScopes] = useState(existing?.scopes ?? 'openid email profile');
  const [metadataUrl, setMetadataUrl] = useState(existing?.metadata_url ?? '');
  const [metadataXml, setMetadataXml] = useState(existing?.metadata_xml ?? '');
  const [emailAttr, setEmailAttr] = useState(existing?.email_attribute ?? 'email');
  const [nameAttr, setNameAttr] = useState(
    existing?.name_attribute ?? 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
  );

  const valid = useMemo(() => {
    if (name.trim().length === 0) return false;
    if (kind === 'oauth') {
      return (
        issuerUrl.trim().length > 0 &&
        clientId.trim().length > 0 &&
        (existing !== undefined || clientSecret.trim().length > 0)
      );
    }
    return metadataUrl.trim().length > 0 || metadataXml.trim().length > 0;
  }, [name, kind, issuerUrl, clientId, clientSecret, metadataUrl, metadataXml, existing]);

  function handleSubmit() {
    if (!valid) {
      notify.error('Missing fields', 'Fill in all required fields.');
      return;
    }
    const base: SsoProvider = {
      id: existing?.id ?? nextId(),
      kind,
      name: name.trim(),
      enabled,
      created_at: existing?.created_at ?? new Date().toISOString(),
    };
    if (kind === 'oauth') {
      base.issuer_url = issuerUrl.trim();
      base.client_id = clientId.trim();
      base.client_secret = clientSecret;
      base.scopes = scopes.trim();
    } else {
      if (metadataUrl.trim()) base.metadata_url = metadataUrl.trim();
      if (metadataXml.trim()) base.metadata_xml = metadataXml.trim();
      base.email_attribute = emailAttr.trim();
      base.name_attribute = nameAttr.trim();
    }
    onSave(base);
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title={existing ? `Edit ${existing.name}` : 'Add SSO provider'}
      size="lg"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        {!existing && (
          <Select
            label="Type"
            data={[
              { value: 'oauth', label: 'OAuth 2.0 / OIDC' },
              { value: 'saml', label: 'SAML 2.0' },
            ]}
            value={kind}
            onChange={(v) => {
              if (v === 'oauth' || v === 'saml') setKind(v);
            }}
            allowDeselect={false}
          />
        )}
        <TextInput
          label="Name"
          placeholder="Acme Corp Okta"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          required
        />

        {kind === 'oauth' && (
          <>
            <TextInput
              label="Issuer URL"
              description="The OIDC discovery URL ending in /.well-known/openid-configuration."
              placeholder="https://acme.okta.com/oauth2/default"
              value={issuerUrl}
              onChange={(e) => {
                setIssuerUrl(e.currentTarget.value);
              }}
              required
            />
            <Group grow>
              <TextInput
                label="Client ID"
                value={clientId}
                onChange={(e) => {
                  setClientId(e.currentTarget.value);
                }}
                required
              />
              <PasswordInput
                label="Client secret"
                value={clientSecret}
                onChange={(e) => {
                  setClientSecret(e.currentTarget.value);
                }}
                placeholder={existing ? '••••••••' : 'Paste your secret'}
                required={!existing}
              />
            </Group>
            <TextInput
              label="Scopes"
              value={scopes}
              onChange={(e) => {
                setScopes(e.currentTarget.value);
              }}
              description="Space-separated. Must include openid email profile for OIDC."
            />
          </>
        )}

        {kind === 'saml' && (
          <>
            <TextInput
              label="Metadata URL"
              description="If your IdP exposes a metadata endpoint."
              placeholder="https://acme.okta.com/app/.../sso/saml/metadata"
              value={metadataUrl}
              onChange={(e) => {
                setMetadataUrl(e.currentTarget.value);
              }}
            />
            <Textarea
              label="Or paste metadata XML"
              minRows={4}
              autosize
              maxRows={10}
              placeholder="<EntityDescriptor xmlns=...>"
              value={metadataXml}
              onChange={(e) => {
                setMetadataXml(e.currentTarget.value);
              }}
              styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
            />
            <Group grow>
              <TextInput
                label="Email attribute"
                value={emailAttr}
                onChange={(e) => {
                  setEmailAttr(e.currentTarget.value);
                }}
              />
              <TextInput
                label="Name attribute"
                value={nameAttr}
                onChange={(e) => {
                  setNameAttr(e.currentTarget.value);
                }}
              />
            </Group>
          </>
        )}

        <Switch
          label="Enabled — accept new sign-ins via this provider"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.currentTarget.checked);
          }}
        />

        {!valid && (
          <Group gap={6} wrap="nowrap">
            <IconAlertCircle size={14} color="var(--mantine-color-yellow-6)" />
            <Text size="xs" c="dimmed">
              Fill in the required fields to save.
            </Text>
          </Group>
        )}

        <Group justify="flex-end" gap="xs" mt="sm">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!valid} leftSection={<IconPlus size={14} />}>
            {existing ? 'Save changes' : 'Add provider'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
