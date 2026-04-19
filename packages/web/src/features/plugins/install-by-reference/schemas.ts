/**
 * Zod schemas for the three install-by-reference sub-forms.
 *
 * Client-side validation is intentionally strict — the approval modal
 * re-checks the resulting candidate, but catching obvious mistakes at
 * the form layer is a better UX than a failed install later.
 */
import { z } from 'zod';

// ─── OCI reference ────────────────────────────────────────────────────────────
// Matches  oci://<host>/<repo-path>:<tag>
//   host:      lower-case letters, digits, '.', '-'
//   repo-path: one or more '/'-separated segments of [a-z0-9._-]
//   tag:       [a-z0-9._-]
const OCI_REGEX = /^oci:\/\/[a-z0-9.-]+(?:\/[a-z0-9._-]+)+:[a-z0-9._-]+$/;

export const ociFormSchema = z.object({
  reference: z
    .string()
    .min(1, 'OCI reference is required')
    .regex(
      OCI_REGEX,
      'Must be an oci:// reference like oci://registry.example.com/my-plugin:1.0.0',
    ),
});

export type OciFormValues = z.infer<typeof ociFormSchema>;

// ─── Tarball upload ──────────────────────────────────────────────────────────
export const tarballFormSchema = z.object({
  // Mantine FileInput yields File | null — we validate .tar.gz/.tgz extensions.
  file: z
    .instanceof(File, { message: 'Please select a tarball file' })
    .refine(
      (f) => f.name.toLowerCase().endsWith('.tar.gz') || f.name.toLowerCase().endsWith('.tgz'),
      { message: 'File must be a .tar.gz or .tgz archive' },
    ),
});

export type TarballFormValues = z.infer<typeof tarballFormSchema>;

// ─── Manifest URL ────────────────────────────────────────────────────────────
//
// Client-side validation rules:
//   1. Must parse as a URL
//   2. Protocol must be https:
//   3. Hostname must be pure ASCII and must NOT contain a trailing-dot sequence
//      (e.g. "host..tld" or "host.")
//   4. Reject obvious typosquat hostnames from a static block-list
export const LOOKALIKE_BLOCKLIST: readonly string[] = [
  'gooogle',
  'googl3',
  'g00gle',
  'githb',
  'gith0b',
  'rioku-labs.example',
  'riokuu',
  'riokuh',
  'ri0ku',
] as const;

export function validateManifestUrl(raw: string):
  | { ok: true; url: URL }
  | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, reason: 'Not a valid URL' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'Manifest URLs must use https://' };
  }
  const host = parsed.hostname;
  // ASCII-only (reject IDN / punycode-lookalike unicode hosts)
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\x7F]/.test(host)) {
    return { ok: false, reason: 'Hostname must be ASCII-only' };
  }
  if (host.endsWith('.') || host.includes('..')) {
    return { ok: false, reason: 'Hostname has an invalid dot sequence' };
  }
  for (const bad of LOOKALIKE_BLOCKLIST) {
    if (host.toLowerCase().includes(bad)) {
      return {
        ok: false,
        reason: `Hostname "${host}" is on the lookalike block-list`,
      };
    }
  }
  return { ok: true, url: parsed };
}

export const manifestUrlFormSchema = z.object({
  url: z
    .string()
    .min(1, 'Manifest URL is required')
    .superRefine((v, ctx) => {
      const res = validateManifestUrl(v);
      if (!res.ok) {
        ctx.addIssue({
          code: 'custom',
          message: res.reason,
        });
      }
    }),
});

export type ManifestUrlFormValues = z.infer<typeof manifestUrlFormSchema>;
