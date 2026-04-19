/**
 * <TailIndicator> — animated badge shown when live-tail mode is active.
 */
import { Badge } from '@mantine/core';

interface TailIndicatorProps {
  liveCount: number;
}

export function TailIndicator({ liveCount }: TailIndicatorProps) {
  return (
    <Badge
      color="teal"
      variant="dot"
      size="sm"
      data-testid="tail-indicator"
      style={{
        animation: 'pulse 2s infinite',
      }}
    >
      Live{liveCount > 0 ? ` +${String(liveCount)}` : ''}
    </Badge>
  );
}
