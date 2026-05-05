/**
 * ProtocolBadge — colored Mantine Badge for upstream protocols.
 * No style wrapper; just maps a known enum to a Mantine color + label.
 */
import { Badge } from '@mantine/core';
import type { Service } from '@/api/resources';

interface ProtocolBadgeProps {
  kind: Service['upstream_protocol'];
}

const PROTOCOL_COLORS: Record<Service['upstream_protocol'], string> = {
  http: 'gray',
  https: 'teal',
  grpc: 'indigo',
};

export function ProtocolBadge({ kind }: ProtocolBadgeProps) {
  return (
    <Badge color={PROTOCOL_COLORS[kind]} variant="light" size="sm">
      {kind.toUpperCase()}
    </Badge>
  );
}
