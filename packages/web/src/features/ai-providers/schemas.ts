/**
 * Zod schemas for AI provider form validation.
 */
import { z } from 'zod';

export const createProviderSchema = z.object({
  name: z.string().min(1).max(80),
  kind: z.enum(['openai', 'anthropic', 'gemini', 'ollama', 'custom']),
  base_url: z.url(),
  description: z.string().max(500).optional(),
  credential: z.string().min(1),
  enabled: z.boolean().default(true),
});

export const updateProviderSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  kind: z.enum(['openai', 'anthropic', 'gemini', 'ollama', 'custom']).optional(),
  base_url: z.url().optional(),
  description: z.string().max(500).optional(),
  credential: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

export const addModelSchema = z.object({
  upstream_id: z.string().min(1),
  alias: z.string().min(1),
  rate_limit_rpm: z.number().int().nullable(),
  daily_quota_tokens: z.number().int().nullable(),
  enabled: z.boolean().default(true),
});

export const updateModelSchema = z.object({
  alias: z.string().min(1).optional(),
  rate_limit_rpm: z.number().int().nullable().optional(),
  daily_quota_tokens: z.number().int().nullable().optional(),
  enabled: z.boolean().optional(),
});

export type CreateProviderFormValues = z.infer<typeof createProviderSchema>;
export type UpdateProviderFormValues = z.infer<typeof updateProviderSchema>;
export type AddModelFormValues = z.infer<typeof addModelSchema>;
export type UpdateModelFormValues = z.infer<typeof updateModelSchema>;
