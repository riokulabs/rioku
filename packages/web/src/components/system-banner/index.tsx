import { Alert, Button, Group } from '@mantine/core';
import type { MantineColor } from '@mantine/core';

export type BannerTone = 'info' | 'warning' | 'critical' | 'success';

const TONE_COLOR: Record<BannerTone, MantineColor> = {
  info: 'blue',
  warning: 'yellow',
  critical: 'red',
  success: 'green',
};

export interface SystemBannerProps {
  tone: BannerTone;
  title?: string;
  description: string;
  /** When true, a close button is rendered */
  dismissible?: boolean;
  onDismiss?: () => void;
  /** Optional primary action rendered at the right of the banner */
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function SystemBanner({
  tone,
  title,
  description,
  dismissible = false,
  onDismiss,
  action,
}: SystemBannerProps) {
  const color = TONE_COLOR[tone];

  return (
    <Alert
      color={color}
      title={title}
      withCloseButton={dismissible}
      closeButtonLabel="Dismiss"
      data-tone={tone}
      {...(dismissible && onDismiss ? { onClose: onDismiss } : {})}
    >
      <Group justify="space-between" align="center" wrap="nowrap">
        <span>{description}</span>
        {action && (
          <Button
            variant="light"
            color={color}
            size="xs"
            onClick={action.onClick}
            style={{ flexShrink: 0 }}
          >
            {action.label}
          </Button>
        )}
      </Group>
    </Alert>
  );
}
