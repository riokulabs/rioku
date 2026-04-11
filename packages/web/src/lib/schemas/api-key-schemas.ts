import { z } from 'zod'

export const createApiKeySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1),
  expiry: z.enum(['30d', '90d', '1y', 'never']),
})

export const updateApiKeySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  scopes: z.array(z.string()).min(1),
})
