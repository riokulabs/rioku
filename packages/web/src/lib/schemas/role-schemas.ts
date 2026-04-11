import { z } from 'zod'

export const permissionRuleSchema = z.object({
  resource: z.string().min(1),
  actions: z.array(z.string()).min(1),
  scope: z.enum(['all', 'owned', 'labeled', 'specific']),
  scopeValue: z.string().optional(),
  effect: z.enum(['allow', 'deny']),
})

export const createRoleSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().optional(),
  rules: z.array(permissionRuleSchema).optional(),
  parentRoleIds: z.array(z.string()).optional(),
})
