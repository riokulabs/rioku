/**
 * <EnrollModal> — generate a new enrollment token and display the join command.
 */
import { useState } from 'react';
import {
  Modal,
  Stack,
  Text,
  Button,
  Group,
  Code,
  CopyButton,
  ActionIcon,
  Tooltip,
  Alert,
  Loader,
} from '@mantine/core';
import { IconCopy, IconCheck, IconAlertCircle } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { generateEnrollmentToken } from '../api';
import type { ClusterEnrollmentToken } from '../types';

interface EnrollModalProps {
  opened: boolean;
  onClose: () => void;
}

export function EnrollModal({ opened, onClose }: EnrollModalProps) {
  const [token, setToken] = useState<ClusterEnrollmentToken | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const joinCmd = token
    ? `rioku cluster join --token ${token.token} --ca /etc/rioku/ca.pem --address <NODE_ADDRESS>`
    : '';

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const t = await generateEnrollmentToken();
      setToken(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate token');
      notify.error('Token generation failed', 'Could not generate an enrollment token.');
    } finally {
      setLoading(false);
    }
  }

  function handleClose() {
    setToken(null);
    setError(null);
    onClose();
  }

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title="Enroll new cluster node"
      size="lg"
    >
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          Generate a single-use enrollment token. Run the displayed command on
          the new node to join it to the cluster. The token expires in 7 days.
        </Text>

        {error && (
          <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
            {error}
          </Alert>
        )}

        {!token ? (
          <Button
            onClick={() => { void handleGenerate(); }}
            loading={loading}
            leftSection={loading ? <Loader size={14} /> : undefined}
          >
            Generate token
          </Button>
        ) : (
          <Stack gap="sm">
            <Text size="sm" fw={500}>
              Token generated — expires{' '}
              {new Date(token.expires_at).toLocaleDateString()}
            </Text>

            <Stack gap={4}>
              <Text size="xs" c="dimmed" fw={500} tt="uppercase">
                Join command
              </Text>
              <Group align="flex-start" gap="xs" wrap="nowrap">
                <Code
                  block
                  style={{ flex: 1, fontSize: 12, wordBreak: 'break-all' }}
                >
                  {joinCmd}
                </Code>
                <CopyButton value={joinCmd} timeout={2000}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? 'Copied!' : 'Copy'} withArrow>
                      <ActionIcon
                        variant="light"
                        color={copied ? 'teal' : 'blue'}
                        onClick={copy}
                        aria-label="Copy join command"
                        mt={4}
                      >
                        {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              </Group>
            </Stack>

            <Text size="xs" c="dimmed">
              Replace <Code>&lt;NODE_ADDRESS&gt;</Code> with the IP or hostname
              of the new node (e.g. <Code>10.0.4.5:7777</Code>).
            </Text>
          </Stack>
        )}

        <Group justify="flex-end">
          <Button variant="default" onClick={handleClose}>
            {token ? 'Done' : 'Cancel'}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
