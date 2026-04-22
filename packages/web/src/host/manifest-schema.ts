/**
 * Plugin manifest Zod schema — spec §9.2.
 *
 * Validates the raw manifest JSON declared by a plugin. Does NOT enforce
 * business rules (reserved-prefix rejection, ABI compat) — those live in the
 * manifest validator (manifest-validator.ts).
 */

import { z } from 'zod';

// ─── Permission entry schema ──────────────────────────────────────────────────

/**
 * Regex for a plugin-declared permission key.
 * Requires reverse-DNS namespace (at least one '.') before ':', optional
 * sub-action segment after ':'.
 * Examples: "com.acme.billing:invoice:read", "io.github.foo:action"
 */
const PERMISSION_KEY_REGEX = /^([a-z0-9]+\.)+[a-z0-9-]+:[a-z0-9-]+(:[a-z0-9-]+)?$/;

const permissionSchema = z.object({
  key: z
    .string()
    .regex(
      PERMISSION_KEY_REGEX,
      'Permission key must be a reverse-DNS namespaced identifier (e.g. "com.acme.plugin:action")',
    ),
  description: z.string().min(1, 'Permission description must not be empty'),
  default_roles: z.array(z.string()).optional(),
});

// ─── Manifest schema ──────────────────────────────────────────────────────────

export const manifestSchema = z.object({
  /** Lowercase letters/digits/hyphens; start/end alphanumeric. Min length 2. */
  name: z
    .string()
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$/,
      'Plugin name must be lowercase alphanumeric with hyphens, starting and ending with an alphanumeric character',
    ),

  /** SemVer-ish: major.minor.patch with optional pre-release suffix. */
  version: z
    .string()
    .regex(
      /^\d+\.\d+\.\d+(-.*)?$/,
      'Plugin version must be SemVer-ish (e.g. "1.0.0" or "1.0.0-beta.1")',
    ),

  displayName: z.string().min(1, 'displayName must not be empty'),

  author: z.object({
    name: z.string().min(1, 'author.name must not be empty'),
    url: z.url('author.url must be a valid URL').optional(),
  }),

  /**
   * Plugin parts — optional entry points.
   * Each is a path or ESM identifier; the host resolves/loads them.
   */
  parts: z
    .object({
      daemon: z.string().optional(),
      caddy: z.string().optional(),
      admin: z.string().optional(),
    })
    .optional(),

  abi: z.object({
    minVersion: z
      .number()
      .int('abi.minVersion must be an integer')
      .min(0, 'abi.minVersion must be >= 0'),
    maxVersion: z
      .number()
      .int('abi.maxVersion must be an integer')
      .min(0, 'abi.maxVersion must be >= 0')
      .optional(),
  }),

  permissions: z.array(permissionSchema).default([]),

  zones: z.array(z.string()).default([]),

  isolation: z.enum(['shared', 'sandbox']).default('shared'),

  settings: z
    .object({
      scope: z.enum(['global', 'tenant', 'both']).default('tenant'),
      embedIn: z.string().optional(),
    })
    .optional(),
});

// ─── Exported type ────────────────────────────────────────────────────────────

export type PluginManifest = z.infer<typeof manifestSchema>;
