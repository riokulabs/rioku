/**
 * <SecretCaptureModal> — non-dismissible modal that surfaces a plaintext
 * secret returned by the daemon (create + rotate emit it exactly once).
 *
 * Closes only when the user clicks "I have copied the key" — clicking
 * outside or hitting ESC is intentionally disabled.
 */
import { useState } from 'react';
import {
  Modal,
  Stack,
  Alert,
  Code,
  Group,
  CopyButton,
  ActionIcon,
  Tooltip,
  Button,
  Text,
} from '@mantine/core';
import { IconAlertCircle, IconCheck, IconCopy } from '@tabler/icons-react';

interface SecretCaptureModalProps {
  opened: boolean;
  secret: string;
  title: string;
  onConfirmCopied: () => void;
}

export function SecretCaptureModal({
  opened,
  secret,
  title,
  onConfirmCopied,
}: SecretCaptureModalProps) {
  const [copiedAtLeastOnce, setCopiedAtLeastOnce] = useState(false);

  return (
    <Modal
      opened={opened && secret !== ''}
      onClose={() => {
        /* swallowed — only the confirm button dismisses */
      }}
      title={title}
      closeOnClickOutside={false}
      closeOnEscape={false}
      withCloseButton={false}
      size="lg"
      data-testid="api-key-secret-modal"
    >
      <Stack gap="md">
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="yellow"
          variant="light"
          title="Save this now"
        >
          This is the only time you will see the full key value. Copy it before continuing.
        </Alert>

        <Stack gap="xs">
          <Text size="sm" fw={500}>
            Plaintext secret
          </Text>
          <Group gap="xs" align="center">
            <Code
              block
              style={{ flex: 1, wordBreak: 'break-all', fontSize: 13 }}
              data-testid="api-key-secret-value"
            >
              {secret}
            </Code>
            <CopyButton value={secret} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied!' : 'Copy'} withArrow>
                  <ActionIcon
                    color={copied ? 'teal' : 'blue'}
                    variant="light"
                    onClick={() => {
                      copy();
                      setCopiedAtLeastOnce(true);
                    }}
                    aria-label="Copy API key"
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
        </Stack>

        <Group justify="flex-end" mt="sm">
          <Button
            variant="filled"
            disabled={!copiedAtLeastOnce}
            onClick={onConfirmCopied}
            data-testid="api-key-secret-confirm"
          >
            I have copied the key
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
