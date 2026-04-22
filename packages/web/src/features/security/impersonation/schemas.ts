/**
 * Zod schemas for the impersonation entry form.
 * spec §8.2 / Task 1d.75
 */
import { z } from 'zod';

const tierValues = ['read', 'read-sensitive', 'write', 'destructive'] as const;

export const impersonationFormSchema = z.object({
  tenant_id: z.string().min(1, 'Tenant is required'),
  user_id: z.string().optional(),
  reason: z
    .string()
    .min(20, 'Reason must be at least 20 characters')
    .max(500, 'Reason must be 500 characters or fewer'),
  ticketRef: z
    .string()
    .optional()
    .refine(
      (val) => {
        if (!val || val.trim() === '') return true;
        // Accept either a URL or a ticket reference like #1234 or JIRA-123
        try {
          new URL(val);
          return true;
        } catch {
          // Allow non-URL ticket references like "#1234", "JIRA-123"
          return /^[#A-Za-z0-9][\w\-#]*$/.test(val.trim());
        }
      },
      { message: 'Must be a valid URL or ticket reference (e.g. #1234, JIRA-123)' },
    ),
  totpCode: z
    .string()
    .length(6, 'TOTP code must be exactly 6 digits')
    .regex(/^\d{6}$/, 'TOTP code must be numeric'),
  profile: z.enum(['minimal', 'full']),
  additionalScope: z.array(z.enum(tierValues)).default([]),
});

export type ImpersonationFormValues = z.infer<typeof impersonationFormSchema>;
