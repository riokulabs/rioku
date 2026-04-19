/**
 * Zod schemas for installed plugin forms.
 *
 * Installed-tab actions (enable/disable/uninstall) do not use complex
 * client-side validation — uninstall uses a typed-slug confirmation that
 * is validated inline. This file is kept for convention parity with the
 * other feature folders.
 */
import { z } from 'zod';

/** Uninstall confirmation — user must type the plugin slug to proceed. */
export const uninstallConfirmSchema = z.object({
  slug_confirm: z.string().min(1, 'Type the plugin slug to confirm'),
});

export type UninstallConfirmFormValues = z.infer<typeof uninstallConfirmSchema>;
