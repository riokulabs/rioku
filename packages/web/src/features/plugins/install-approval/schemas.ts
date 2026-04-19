/**
 * Install-approval schemas — single-checkbox confirm for high-privilege grants.
 */
import { z } from 'zod';

export const approvalConfirmSchema = z.object({
  second_confirm: z.boolean(),
});

export type ApprovalConfirmFormValues = z.infer<typeof approvalConfirmSchema>;
