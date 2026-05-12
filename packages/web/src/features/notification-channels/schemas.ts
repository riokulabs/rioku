/**
 * Zod schemas for notification-channels feature.
 *
 * `channelConfigSchemas` holds per-kind config shapes. The top-level create /
 * update schemas use `z.unknown()` for `config`; UI code calls
 * `channelConfigSchemas[kind].parse(config)` for per-kind validation.
 */
import { z } from 'zod';

// ─── Per-kind config schemas ─────────────────────────────────────────────────

export const emailChannelConfigSchema = z.object({
  to: z.email(),
  from: z.email(),
  smtp_host: z.string().min(1).optional(),
  smtp_port: z.number().int().min(1).max(65535).optional(),
  smtp_user: z.string().optional(),
  smtp_password: z.string().optional(),
});

export const slackChannelConfigSchema = z.object({
  webhook_url: z.url(),
});

export const webhookChannelConfigSchema = z.object({
  url: z.url(),
  headers: z.record(z.string(), z.string()).optional(),
  method: z.enum(['POST']).default('POST'),
});

export const pagerdutyChannelConfigSchema = z.object({
  routing_key: z.string().min(1),
});

export const teamsChannelConfigSchema = z.object({
  webhook_url: z.url(),
});

export const smsChannelConfigSchema = z.object({
  twilio_sid: z.string().optional(),
  twilio_token: z.string().optional(),
  from_number: z.string().optional(),
});

export const channelConfigSchemas = {
  email: emailChannelConfigSchema,
  slack: slackChannelConfigSchema,
  webhook: webhookChannelConfigSchema,
  pagerduty: pagerdutyChannelConfigSchema,
  teams: teamsChannelConfigSchema,
  sms: smsChannelConfigSchema,
} as const;

export const CHANNEL_KINDS = ['email', 'slack', 'webhook', 'pagerduty', 'teams', 'sms'] as const;

export const channelKindSchema = z.enum(CHANNEL_KINDS);

// ─── Top-level CRUD schemas ──────────────────────────────────────────────────

export const createChannelSchema = z.object({
  tenant_id: z.string().min(1),
  name: z.string().min(1).max(80),
  kind: channelKindSchema,
  config: z.unknown(),
  enabled: z.boolean().default(true),
});

export const updateChannelSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  config: z.unknown().optional(),
  enabled: z.boolean().optional(),
});

export type CreateChannelFormValues = z.infer<typeof createChannelSchema>;
export type UpdateChannelFormValues = z.infer<typeof updateChannelSchema>;

/**
 * Parse `config` against the schema for `kind`. Throws a ZodError on
 * mismatch. Returns the parsed value (with defaults applied).
 */
export function parseChannelConfig(
  kind: (typeof CHANNEL_KINDS)[number],
  config: unknown,
): Record<string, unknown> {
  const schema = channelConfigSchemas[kind];
  return schema.parse(config);
}
