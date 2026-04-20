/**
 * <TenantSection> — settings tenant section.
 *
 * Renders 5 subsections:
 *   1. Slug (read-only with contact-admin note)
 *   2. Display name (inline-edit)
 *   3. URL mode (SegmentedControl path vs subdomain)
 *   4. Theme override (Select of all registered themes + "System default")
 *   5. Logo uploader (Dropzone)
 *
 * Requires `tenant:write` for all mutations. Read is always visible.
 *
 * Task 8a.3
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Alert,
  Button,
  Divider,
  Group,
  Image,
  SegmentedControl,
  Select,
  Stack,
  Text,
  TextInput,
  Title,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { IconAlertCircle, IconPhoto, IconUpload, IconX } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { BUILTIN_THEMES } from '@/theme';
import { usePluginThemes } from '@/hooks/use-plugin-themes';
import { useCurrentTenant, updateTenantName, updateTenantUrlMode, updateTenantDefaultTheme, updateTenantLogo } from '../api';
import { tenantNameSchema } from '../schemas';

// ─── URL mode labels ──────────────────────────────────────────────────────────

const URL_MODE_DATA: { label: string; value: string }[] = [
  { label: 'Path (/t/<slug>/...)', value: 'path' },
  { label: 'Subdomain (<slug>.example.com)', value: 'subdomain' },
];

// ─── System-default sentinel ──────────────────────────────────────────────────

const SYSTEM_DEFAULT_VALUE = '__system_default__';

// ─── Component ────────────────────────────────────────────────────────────────

export function TenantSection() {
  const tenant = useCurrentTenant();
  const canWrite = usePermission('tenant:write');

  // ── Theme list ───────────────────────────────────────────────────────────
  const pluginThemes = usePluginThemes();
  const allThemes = [...BUILTIN_THEMES, ...pluginThemes];
  const themeSelectData = [
    { label: 'System default', value: SYSTEM_DEFAULT_VALUE },
    ...allThemes.map((t) => ({ label: t.displayName, value: t.name })),
  ];

  // ── Name form ─────────────────────────────────────────────────────────────
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const nameForm = useForm({
    initialValues: { name: tenant?.name ?? '' },
    validate: schemaResolver(tenantNameSchema, { sync: true }),
  });

  // Reset form if tenant changes (e.g. on tenant switch)
  useEffect(() => {
    if (tenant) nameForm.setValues({ name: tenant.name });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id]);

  const handleNameSubmit = useCallback(
    async (values: { name: string }) => {
      if (!tenant) return;
      setNameLoading(true);
      setNameError(null);
      try {
        await updateTenantName(tenant.id, values.name);
        notify.success('Tenant name updated', `Display name changed to "${values.name}".`);
        nameForm.resetDirty(values);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update tenant name';
        setNameError(msg);
      } finally {
        setNameLoading(false);
      }
    },
    [tenant, nameForm],
  );

  // ── URL mode ──────────────────────────────────────────────────────────────
  const [urlModeLoading, setUrlModeLoading] = useState(false);
  const [urlModeError, setUrlModeError] = useState<string | null>(null);

  const handleUrlModeChange = useCallback(
    async (value: string) => {
      if (!tenant) return;
      if (value !== 'path' && value !== 'subdomain') return;
      setUrlModeLoading(true);
      setUrlModeError(null);
      try {
        await updateTenantUrlMode(tenant.id, value);
        notify.success('URL mode updated');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update URL mode';
        setUrlModeError(msg);
      } finally {
        setUrlModeLoading(false);
      }
    },
    [tenant],
  );

  // ── Theme override ────────────────────────────────────────────────────────
  const [themeLoading, setThemeLoading] = useState(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  const handleThemeChange = useCallback(
    async (value: string | null) => {
      if (!tenant) return;
      setThemeLoading(true);
      setThemeError(null);
      try {
        const resolved = value === SYSTEM_DEFAULT_VALUE || value === null ? undefined : value;
        await updateTenantDefaultTheme(tenant.id, resolved);
        notify.success('Theme override updated');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update theme';
        setThemeError(msg);
      } finally {
        setThemeLoading(false);
      }
    },
    [tenant],
  );

  // ── Logo uploader ─────────────────────────────────────────────────────────
  const [logoPreview, setLogoPreview] = useState<string | null>(
    tenant?.logo_url ?? null,
  );
  const [logoLoading, setLogoLoading] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);

  // Revoke blob: URLs on unmount / preview change to prevent leaks.
  useEffect(
    () => () => {
      if (logoPreview?.startsWith('blob:')) URL.revokeObjectURL(logoPreview);
    },
    [logoPreview],
  );

  const handleLogoDrop = useCallback(
    async (files: File[]) => {
      if (!tenant) return;
      const file = files[0];
      if (!file) return;
      setLogoLoading(true);
      setLogoError(null);
      try {
        const url = URL.createObjectURL(file);
        setLogoPreview(url);
        await updateTenantLogo(tenant.id, url);
        notify.success('Logo updated');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to upload logo';
        setLogoError(msg);
      } finally {
        setLogoLoading(false);
      }
    },
    [tenant],
  );

  const handleRemoveLogo = useCallback(async () => {
    if (!tenant) return;
    setLogoLoading(true);
    setLogoError(null);
    try {
      setLogoPreview(null);
      await updateTenantLogo(tenant.id, null);
      notify.success('Logo removed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove logo';
      setLogoError(msg);
    } finally {
      setLogoLoading(false);
    }
  }, [tenant]);

  // ── Render ────────────────────────────────────────────────────────────────

  if (!tenant) {
    return (
      <Text size="sm" c="var(--mantine-color-gray-7)" data-testid="tenant-loading">
        Loading tenant…
      </Text>
    );
  }

  const currentThemeValue = tenant.default_theme ?? SYSTEM_DEFAULT_VALUE;

  return (
    <Stack gap="xl" data-testid="tenant-section">
      {/* ── 1. Slug ──────────────────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5}>Tenant identifier</Title>
        <TextInput
          label="Slug"
          value={tenant.slug}
          readOnly
          description="Contact a super-admin to change the slug."
          data-testid="tenant-slug-input"
        />
      </Stack>

      <Divider />

      {/* ── 2. Display name ──────────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5}>Display name</Title>
        <form
          onSubmit={nameForm.onSubmit((v) => {
            void handleNameSubmit(v);
          })}
          data-testid="tenant-name-form"
        >
          <Stack gap="xs">
            {nameError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" py="xs">
                {nameError}
              </Alert>
            )}
            <Group align="flex-end" gap="sm">
              <TextInput
                label="Tenant name"
                style={{ flex: 1 }}
                disabled={!canWrite}
                data-testid="tenant-name-input"
                {...nameForm.getInputProps('name')}
              />
              {nameForm.isDirty() && (
                <Tooltip
                  label="You don't have permission to update tenant settings"
                  disabled={canWrite}
                  withArrow
                >
                  <span>
                    <Button
                      type="submit"
                      loading={nameLoading}
                      disabled={!canWrite}
                      size="sm"
                      data-testid="tenant-name-save"
                    >
                      Save
                    </Button>
                  </span>
                </Tooltip>
              )}
            </Group>
          </Stack>
        </form>
      </Stack>

      <Divider />

      {/* ── 3. URL mode ──────────────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5}>URL mode</Title>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Choose how this tenant is addressed in URLs.
        </Text>
        {urlModeError && (
          <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" py="xs">
            {urlModeError}
          </Alert>
        )}
        <Tooltip
          label="You don't have permission to update tenant settings"
          disabled={canWrite}
          withArrow
        >
          <span style={{ alignSelf: 'flex-start' }}>
            <SegmentedControl
              data={URL_MODE_DATA}
              value={tenant.url_mode}
              onChange={(v) => { void handleUrlModeChange(v); }}
              disabled={!canWrite || urlModeLoading}
              data-testid="tenant-url-mode-control"
            />
          </span>
        </Tooltip>
      </Stack>

      <Divider />

      {/* ── 4. Theme override ─────────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5}>Theme override</Title>
        <Text size="sm" c="var(--mantine-color-gray-7)">
          Set a default theme for this tenant. Members can still override it in their own preferences.
        </Text>
        {themeError && (
          <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" py="xs">
            {themeError}
          </Alert>
        )}
        <Select
          label="Default theme"
          data={themeSelectData}
          value={currentThemeValue}
          onChange={(v) => { void handleThemeChange(v); }}
          disabled={!canWrite || themeLoading}
          style={{ maxWidth: 300 }}
          data-testid="tenant-theme-select"
        />
      </Stack>

      <Divider />

      {/* ── 5. Logo ───────────────────────────────────────────────────────── */}
      <Stack gap="sm">
        <Title order={5}>Logo</Title>
        <Group align="flex-start" gap="md">
          {logoPreview && (
            <Image
              src={logoPreview}
              w={64}
              h={64}
              fit="contain"
              radius="sm"
              data-testid="tenant-logo-preview"
            />
          )}
          <Stack gap="xs" flex={1}>
            {logoError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" py="xs">
                {logoError}
              </Alert>
            )}
            <Tooltip
              label="You don't have permission to update tenant settings"
              disabled={canWrite}
              withArrow
            >
              <div>
                <Dropzone
                  onDrop={(files) => { void handleLogoDrop(files); }}
                  onReject={(files) => {
                    const reason = files[0]?.errors[0]?.code;
                    const msg =
                      reason === 'file-too-large'
                        ? 'Image must be 3 MB or smaller.'
                        : 'Only image files are accepted.';
                    setLogoError(msg);
                  }}
                  accept={IMAGE_MIME_TYPE}
                  maxSize={3 * 1024 ** 2}
                  maxFiles={1}
                  disabled={!canWrite || logoLoading}
                  data-testid="tenant-logo-dropzone"
                >
                  <Group gap="xs" style={{ pointerEvents: 'none' }}>
                    <Dropzone.Accept>
                      <IconUpload size={16} />
                    </Dropzone.Accept>
                    <Dropzone.Reject>
                      <IconX size={16} />
                    </Dropzone.Reject>
                    <Dropzone.Idle>
                      <IconPhoto size={16} />
                    </Dropzone.Idle>
                    <Text size="sm">
                      Drop a logo image here or click to upload (max 3 MB)
                    </Text>
                  </Group>
                </Dropzone>
              </div>
            </Tooltip>
            {logoPreview !== null && (
              <Button
                variant="subtle"
                color="red"
                size="xs"
                onClick={() => { void handleRemoveLogo(); }}
                loading={logoLoading}
                disabled={!canWrite}
                data-testid="tenant-logo-remove"
              >
                Remove logo
              </Button>
            )}
          </Stack>
        </Group>
      </Stack>
    </Stack>
  );
}
