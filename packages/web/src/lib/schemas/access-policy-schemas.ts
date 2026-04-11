import { z } from 'zod'

export const timeConditionSchema = z.object({ type: z.literal('time'), config: z.object({ startTime: z.string(), endTime: z.string(), daysOfWeek: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])), timezone: z.string() }) })
export const ipConditionSchema = z.object({ type: z.literal('ip'), config: z.object({ cidrRanges: z.array(z.string()).min(1), negate: z.boolean().default(false) }) })
export const mfaConditionSchema = z.object({ type: z.literal('mfa'), config: z.object({ required: z.boolean() }) })
export const geoConditionSchema = z.object({ type: z.literal('geo'), config: z.object({ countryCodes: z.array(z.string()).min(1), negate: z.boolean().default(false) }) })
export const deviceConditionSchema = z.object({ type: z.literal('device'), config: z.object({ allowedUserAgents: z.array(z.string()).min(1) }) })
export const customConditionSchema = z.object({ type: z.literal('custom'), config: z.object({ expression: z.string().min(1) }) })

export const accessConditionSchema = z.discriminatedUnion('type', [timeConditionSchema, ipConditionSchema, mfaConditionSchema, geoConditionSchema, deviceConditionSchema, customConditionSchema])

export const accessPolicySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
  targetType: z.enum(['roles', 'users']),
  targetIds: z.array(z.string()).min(1),
  conditions: z.array(accessConditionSchema).min(1),
  priority: z.number().int().nonnegative(),
  enabled: z.boolean().default(true),
})
