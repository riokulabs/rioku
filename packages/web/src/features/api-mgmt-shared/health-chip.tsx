/**
 * HealthChip — colored Mantine Badge mapping Service health to a chip.
 * No style wrapper; just an enum→color→label map.
 */
import { Badge } from '@mantine/core';
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

export function HealthChip({ status }: HealthChipProps) {
  return (
    <Badge color={HEALTH_COLORS[status]} variant="light" size="sm">
      {status}
    </Badge>
  );
}
