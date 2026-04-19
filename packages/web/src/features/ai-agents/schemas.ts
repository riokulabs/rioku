/**
 * Zod schemas for AI agent form validation.
 */
import { z } from 'zod';

export const createAgentSchema = z.object({
  name: z.string().min(1).max(80),
  provider_id: z.string().min(1),
  model: z.string().min(1),
  system_prompt: z.string().min(1).max(8000),
  tool_ids: z.array(z.string()),
  enabled: z.boolean().default(true),
  description: z.string().max(500).optional(),
  scoped_credential: z.string().min(1).optional(),
  role_ids: z.array(z.string()),
  max_tokens_per_request: z.number().int().min(1).max(128_000),
  temperature: z.number().min(0).max(2),
  stop_sequences: z.array(z.string().min(1)).max(10),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  provider_id: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  system_prompt: z.string().min(1).max(8000).optional(),
  tool_ids: z.array(z.string()).optional(),
  enabled: z.boolean().optional(),
  description: z.string().max(500).optional(),
  role_ids: z.array(z.string()).optional(),
  max_tokens_per_request: z.number().int().min(1).max(128_000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  stop_sequences: z.array(z.string().min(1)).max(10).optional(),
});

export const rotateScopedCredentialSchema = z.object({
  credential: z.string().min(1),
});

export const invokeAgentSchema = z.object({
  prompt: z.string().min(1).max(16_000),
  session_id: z.string().min(1).optional(),
});

export type CreateAgentFormValues = z.infer<typeof createAgentSchema>;
export type UpdateAgentFormValues = z.infer<typeof updateAgentSchema>;
export type RotateScopedCredentialFormValues = z.infer<
  typeof rotateScopedCredentialSchema
>;
export type InvokeAgentFormValues = z.infer<typeof invokeAgentSchema>;
