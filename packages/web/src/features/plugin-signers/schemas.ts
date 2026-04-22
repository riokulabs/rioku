/**
 * Zod schemas for plugin-signer form validation (Plan 6).
 */
import { z } from 'zod';

/** SHA-256 hex fingerprint: exactly 64 lowercase hex characters. */
const fingerprintSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, 'Fingerprint must be 64 lowercase hex characters (SHA-256).');

export const createSignerSchema = z.object({
  // Optional on the form-level schema — the <SignerForm> derives the final
  // tenant_scope from the scope segmented control + tenantId prop before
  // invoking the API. The API-level payload always carries a concrete
  // `tenant_scope: ID | null`. Making this optional here lets
  // `schemaResolver` on the form values validate without a spurious
  // "tenant_scope required" error.
  tenant_scope: z.string().nullable().optional(),
  name: z.string().min(1).max(120),
  fingerprint: fingerprintSchema,
  description: z.string().max(500).optional(),
  status: z.enum(['verified', 'revoked', 'pending']).optional(),
  // The form values include a `scope` segmented control; pass it through
  // without validation (the scope-to-tenant_scope translation lives in
  // handleSubmit).
  scope: z.enum(['tenant', 'global']).optional(),
});

export const updateSignerSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(500).optional(),
  fingerprint: fingerprintSchema.optional(),
});

export type CreateSignerFormValues = z.infer<typeof createSignerSchema>;
export type UpdateSignerFormValues = z.infer<typeof updateSignerSchema>;
