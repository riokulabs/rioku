/**
 * Zod schemas for API key forms.
 */
import { z } from 'zod';

export const createApiKeySchema = z.object({
  name: z.string().min(1, 'Name is required').max(120, 'Name too long'),
  scope: z.array(z.string()).min(1, 'At least one permission scope is required'),
  expires_at: z.string().optional(),
});

export type CreateApiKeyFormValues = z.infer<typeof createApiKeySchema>;
