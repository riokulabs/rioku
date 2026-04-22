/**
 * HealthChip — colored Mantine Badge mapping Service health to a chip.
 * No style wrapper; just an enum→color+variant→label map.
 *
 * Variant rule: error/warn states use "filled" to draw attention; healthy
 * uses "light" (informational); disabled uses "outline" (muted/off).
 */
import { Badge } from '@mantine/core';
import type { BadgeVariant } from '@mantine/core';
import type { Service } from '@/api/resources/types';

interface HealthChipProps {
  status: Service['health'];
}

const HEALTH_COLORS: Record<Service['health'], string> = {
  healthy: 'green',
  degraded: 'yellow',
  unhealthy: 'red',
  disabled: 'gray',
};

const HEALTH_VARIANTS: Record<Service['health'], BadgeVariant> = {
  healthy: 'light',
  degraded: 'filled',
  unhealthy: 'filled',
  disabled: 'outline',
};

export function HealthChip({ status }: HealthChipProps) {
  return (
    <Badge color={HEALTH_COLORS[status]} variant={HEALTH_VARIANTS[status]} autoContrast size="sm">
      {status}
    </Badge>
  );
}
