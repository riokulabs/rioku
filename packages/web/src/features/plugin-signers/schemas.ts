/**
 * Zod schemas for plugin-signer form validation (Plan 6).
 */
import { z } from 'zod';

/** SHA-256 hex fingerprint: exactly 64 lowercase hex characters. */
const fingerprintSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Fingerprint must be 64 lowercase hex characters (SHA-256).');

export const createSignerSchema = z.object({
  tenant_scope: z.string().nullable(),
  name: z.string().min(1).max(120),
  fingerprint: fingerprintSchema,
  description: z.string().max(500).optional(),
  status: z.enum(['verified', 'revoked', 'pending']).optional(),
});

export const updateSignerSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  fingerprint: fingerprintSchema.optional(),
});

export type CreateSignerFormValues = z.infer<typeof createSignerSchema>;
export type UpdateSignerFormValues = z.infer<typeof updateSignerSchema>;
