/**
 * Install-by-reference forms.
 *
 * Three stacked Cards: OCI reference, tarball upload, manifest URL.
 * Each form onSubmit builds an InstallCandidate and passes it to the
 * install-approval modal via `onRequestApproval`.
 *
 * No actual I/O happens here — stage 1 is UI-only. The candidate produced
 * is a plausible shape the approval UI can render.
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Card,
  FileInput,
  Group,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import {
  IconAlertCircle,
  IconBrandDocker,
  IconFileZip,
  IconLink,
  IconShieldCheck,
} from '@tabler/icons-react';
import {
  ociFormSchema,
  tarballFormSchema,
  manifestUrlFormSchema,
  validateManifestUrl,
} from '../schemas';
import type { OciFormValues, TarballFormValues, ManifestUrlFormValues } from '../schemas';
import type { InstallCandidate } from '../types';

interface InstallByReferenceFormsProps {
  onRequestApproval: (candidate: InstallCandidate) => void;
}

function parseOciRef(ref: string): { host: string; repo: string; tag: string } | null {
  // oci://host/path:tag
  const stripped = ref.replace(/^oci:\/\//, '');
  const lastColon = stripped.lastIndexOf(':');
  if (lastColon === -1) return null;
  const tag = stripped.slice(lastColon + 1);
  const hostAndPath = stripped.slice(0, lastColon);
  const firstSlash = hostAndPath.indexOf('/');
  if (firstSlash === -1) return null;
  const host = hostAndPath.slice(0, firstSlash);
  const repo = hostAndPath.slice(firstSlash + 1);
  return { host, repo, tag };
}

function slugFromRepo(repo: string): string {
  // reverse-dns-ish: last path segment
  const parts = repo.split('/');
  return parts[parts.length - 1] ?? repo;
}

export function InstallByReferenceForms({ onRequestApproval }: InstallByReferenceFormsProps) {
  const [submitting, setSubmitting] = useState<string | null>(null);

  // ─── OCI form ───────────────────────────────────────────────────────────────
  const ociForm = useForm<OciFormValues>({
    validate: schemaResolver(ociFormSchema, { sync: true }),
    initialValues: { reference: '' },
  });

  function handleOciSubmit(values: OciFormValues) {
    setSubmitting('oci');
    try {
      const parsed = parseOciRef(values.reference);
      if (!parsed) return;
      const slug = slugFromRepo(parsed.repo);
      const candidate: InstallCandidate = {
        slug,
        display_name: slug,
        version: parsed.tag,
        source: 'oci',
        reference: values.reference,
        signer: parsed.host,
        declared_permissions: [`${slug}:read`, `${slug}:write`],
        parts: ['daemon'],
        manifest: { slug, version: parsed.tag, zones: [], api_scopes: [] },
      };
      onRequestApproval(candidate);
    } finally {
      setSubmitting(null);
    }
  }

  // ─── Tarball form ───────────────────────────────────────────────────────────
  const tarballForm = useForm<TarballFormValues>({
    validate: schemaResolver(tarballFormSchema, { sync: true }),
    // We can't default File; use undefined cast to satisfy initial values shape.
    initialValues: { file: undefined as unknown as File },
  });

  function handleTarballSubmit(values: TarballFormValues) {
    setSubmitting('tarball');
    try {
      const f = values.file;
      // Strip .tar.gz / .tgz extension for a slug-like name
      const baseName = f.name.replace(/\.(tar\.gz|tgz)$/i, '');
      const slug = baseName.toLowerCase().replace(/[^a-z0-9._-]/g, '-');
      const candidate: InstallCandidate = {
        slug,
        display_name: baseName,
        version: '0.0.0-local',
        source: 'tarball',
        reference: `${f.name} (${f.size.toLocaleString()} bytes)`,
        signer: 'unverified',
        declared_permissions: [`${slug}:read`],
        parts: ['admin'],
        manifest: { slug, zones: [], api_scopes: [] },
      };
      onRequestApproval(candidate);
    } finally {
      setSubmitting(null);
    }
  }

  // ─── Manifest URL form ──────────────────────────────────────────────────────
  const urlForm = useForm<ManifestUrlFormValues>({
    validate: schemaResolver(manifestUrlFormSchema, { sync: true }),
    initialValues: { url: '' },
  });

  function handleUrlSubmit(values: ManifestUrlFormValues) {
    setSubmitting('url');
    try {
      const res = validateManifestUrl(values.url);
      if (!res.ok) return;
      const host = res.url.hostname;
      const pathParts = res.url.pathname.split('/').filter(Boolean);
      const fileName = pathParts[pathParts.length - 1] ?? 'plugin';
      const slug = fileName
        .replace(/\.json$/i, '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]/g, '-');
      const candidate: InstallCandidate = {
        slug,
        display_name: slug,
        version: '0.0.0-remote',
        source: 'manifest-url',
        reference: values.url,
        signer: host,
        declared_permissions: [`${slug}:read`],
        parts: ['admin'],
        manifest: { slug, zones: [], api_scopes: [] },
      };
      onRequestApproval(candidate);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <Stack gap="lg">
      {/* OCI reference */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconBrandDocker size={18} color="var(--mantine-color-blue-6)" />
            <Title order={5}>Install from OCI registry</Title>
          </Group>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            Pull a signed plugin image from any OCI-compatible registry.
          </Text>
          <form
            onSubmit={ociForm.onSubmit((v) => {
              handleOciSubmit(v);
            })}
          >
            <Stack gap="sm">
              <TextInput
                label="OCI reference"
                description="Format: oci://registry/image:tag"
                placeholder="oci://registry.example.com/my-plugin:1.0.0"
                required
                {...ociForm.getInputProps('reference')}
              />
              <Group justify="flex-end">
                <Button
                  type="submit"
                  size="sm"
                  leftSection={<IconShieldCheck size={14} />}
                  loading={submitting === 'oci'}
                >
                  Review &amp; install
                </Button>
              </Group>
            </Stack>
          </form>
        </Stack>
      </Card>

      {/* Tarball upload */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconFileZip size={18} color="var(--mantine-color-orange-6)" />
            <Title order={5}>Upload plugin tarball</Title>
          </Group>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            Select a locally built .tar.gz or .tgz archive.
          </Text>
          <Alert icon={<IconAlertCircle size={14} />} color="yellow" variant="light" p="xs">
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Unsigned tarballs are marked as &quot;unverified&quot; in the approval step.
            </Text>
          </Alert>
          <form
            onSubmit={tarballForm.onSubmit((v) => {
              handleTarballSubmit(v);
            })}
          >
            <Stack gap="sm">
              <FileInput
                label="Tarball file"
                placeholder="Select .tar.gz or .tgz"
                accept=".tar.gz,.tgz,application/gzip,application/x-gzip"
                required
                clearable
                {...tarballForm.getInputProps('file')}
              />
              <Group justify="flex-end">
                <Button
                  type="submit"
                  size="sm"
                  leftSection={<IconShieldCheck size={14} />}
                  loading={submitting === 'tarball'}
                >
                  Review &amp; install
                </Button>
              </Group>
            </Stack>
          </form>
        </Stack>
      </Card>

      {/* Manifest URL */}
      <Card withBorder radius="md" p="md">
        <Stack gap="sm">
          <Group gap="xs">
            <IconLink size={18} color="var(--mantine-color-teal-6)" />
            <Title order={5}>Install from manifest URL</Title>
          </Group>
          <Text size="sm" c="var(--mantine-color-gray-7)">
            Fetch a plugin manifest JSON over HTTPS. Lookalike hostnames are blocked client-side.
          </Text>
          <form
            onSubmit={urlForm.onSubmit((v) => {
              handleUrlSubmit(v);
            })}
          >
            <Stack gap="sm">
              <TextInput
                label="Manifest URL"
                description="Must use https:// and have an ASCII hostname"
                placeholder="https://registry.example.com/plugins/my-plugin.json"
                required
                {...urlForm.getInputProps('url')}
              />
              <Group justify="flex-end">
                <Button
                  type="submit"
                  size="sm"
                  leftSection={<IconShieldCheck size={14} />}
                  loading={submitting === 'url'}
                >
                  Review &amp; install
                </Button>
              </Group>
            </Stack>
          </form>
        </Stack>
      </Card>
    </Stack>
  );
}
