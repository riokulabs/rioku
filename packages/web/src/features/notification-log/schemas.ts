/**
 * Zod schemas for the notification-log feature.
 */
import { z } from 'zod';

export const deliveryStatusSchema = z.enum([
  'delivered',
  'retrying',
  'failed',
  'pending',
]);

export const deliveryLogFilterSchema = z.object({
  statuses: z.array(deliveryStatusSchema).default([]),
  channel_ids: z.array(z.string().min(1)).default([]),
  date_from: z.string().nullable().default(null),
  date_to: z.string().nullable().default(null),
  search: z.string().max(500).default(''),
});

export type DeliveryLogFilterFormValues = z.infer<typeof deliveryLogFilterSchema>;
