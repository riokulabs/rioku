/**
 * <ProfilePasskeys> — register and manage WebAuthn passkeys.
 *
 * Stage-1 mock: passkeys are stored in component-local state. The "Register"
 * flow simulates the WebAuthn ceremony — in a real environment we'd call
 * `navigator.credentials.create()` and post the attestation. The UI matches
 * the real flow: pick a name, optional authenticator-attachment hint, then
 * commit.
 */
import { useState } from 'react';
import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Group,
  Modal,
  Select,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import {
  IconDeviceMobile,
  IconFingerprint,
  IconKey,
  IconPlus,
  IconShieldCheck,
  IconTrash,
} from '@tabler/icons-react';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { notify } from '@/hooks/use-notify';
import { makeIdFactory } from '@/lib/id-generator';

dayjs.extend(relativeTime);

type AttachmentHint = 'platform' | 'cross-platform';

interface Passkey {
  id: string;
  name: string;
  attachment: AttachmentHint;
  /** Last 4 chars of the credential id, hex. */
  credential_id_short: string;
  created_at: string;
  last_used?: string;
}

const nextId = makeIdFactory('passkey');

function shortCredId(): string {
  const chars = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

interface ProfilePasskeysProps {
  canUpdate: boolean;
}

export function ProfilePasskeys({ canUpdate }: ProfilePasskeysProps) {
  const [passkeys, setPasskeys] = useState<Passkey[]>([]);
  const [registering, setRegistering] = useState(false);
  const [deleting, setDeleting] = useState<Passkey | null>(null);

  function handleRegister(passkey: Omit<Passkey, 'id' | 'credential_id_short' | 'created_at'>) {
    const created: Passkey = {
      ...passkey,
      id: nextId(),
      credential_id_short: shortCredId(),
      created_at: new Date().toISOString(),
    };
    setPasskeys((prev) => [...prev, created]);
    notify.success('Passkey registered', `${created.name} is now active on your account.`);
    setRegistering(false);
  }

  function handleDelete(id: string) {
    const target = passkeys.find((p) => p.id === id);
    setPasskeys((prev) => prev.filter((p) => p.id !== id));
    if (target) notify.success('Passkey removed', `${target.name} was removed.`);
    setDeleting(null);
  }

  return (
    <Stack gap="sm" data-testid="profile-passkeys-section">
      <Group justify="space-between" align="center" wrap="wrap">
        <Stack gap={2}>
          <Group gap="xs">
            <Text size="sm" fw={600}>
              Passkeys
            </Text>
            {passkeys.length > 0 && (
              <Badge
                size="xs"
                variant="light"
                color="green"
                leftSection={<IconShieldCheck size={10} />}
              >
                {String(passkeys.length)} active
              </Badge>
            )}
          </Group>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            Phishing-resistant sign-in via WebAuthn. Use Touch ID, Windows Hello, or a hardware
            security key.
          </Text>
        </Stack>
        <Tooltip
          label="You don't have permission to update your profile"
          disabled={canUpdate}
          withArrow
        >
          <span>
            <Button
              size="sm"
              leftSection={<IconPlus size={14} />}
              disabled={!canUpdate}
              onClick={() => {
                setRegistering(true);
              }}
              data-testid="profile-passkey-register"
            >
              Register passkey
            </Button>
          </span>
        </Tooltip>
      </Group>

      {passkeys.length === 0 ? (
        <Box
          p="md"
          ta="center"
          style={{
            border: '1px dashed var(--mantine-color-default-border)',
            borderRadius: 'var(--mantine-radius-md)',
          }}
        >
          <Text size="sm" c="dimmed">
            No passkeys yet. Register one to skip TOTP on trusted devices.
          </Text>
        </Box>
      ) : (
        <Stack gap="xs">
          {passkeys.map((pk) => (
            <PasskeyRow
              key={pk.id}
              passkey={pk}
              canUpdate={canUpdate}
              onDelete={() => {
                setDeleting(pk);
              }}
            />
          ))}
        </Stack>
      )}

      {registering && (
        <PasskeyRegisterModal
          onClose={() => {
            setRegistering(false);
          }}
          onRegister={handleRegister}
        />
      )}

      {deleting && (
        <Modal
          opened
          onClose={() => {
            setDeleting(null);
          }}
          title="Remove passkey?"
          size="sm"
          transitionProps={{ duration: 0 }}
        >
          <Stack gap="md">
            <Text size="sm">
              Sign-ins using <strong>{deleting.name}</strong> will stop working immediately. Make
              sure you have at least one other authenticator set up before removing.
            </Text>
            <Group justify="flex-end">
              <Button
                variant="default"
                onClick={() => {
                  setDeleting(null);
                }}
              >
                Cancel
              </Button>
              <Button
                color="red"
                onClick={() => {
                  handleDelete(deleting.id);
                }}
              >
                Remove passkey
              </Button>
            </Group>
          </Stack>
        </Modal>
      )}
    </Stack>
  );
}

interface PasskeyRowProps {
  passkey: Passkey;
  canUpdate: boolean;
  onDelete: () => void;
}

function PasskeyRow({ passkey, canUpdate, onDelete }: PasskeyRowProps) {
  const Icon = passkey.attachment === 'platform' ? IconFingerprint : IconKey;
  const attachmentLabel = passkey.attachment === 'platform' ? 'On this device' : 'Security key';
  return (
    <Group
      gap="md"
      wrap="nowrap"
      align="center"
      p="sm"
      style={{
        border: '1px solid var(--mantine-color-default-border)',
        borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <Box
        style={{
          width: 32,
          height: 32,
          borderRadius: 6,
          background: 'var(--mantine-color-default-hover)',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          color: 'var(--mantine-color-riokuOrange-6)',
        }}
      >
        <Icon size={16} />
      </Box>
      <Stack gap={2} style={{ flex: 1, minWidth: 0 }}>
        <Group gap="xs" wrap="nowrap">
          <Text size="sm" fw={600} truncate>
            {passkey.name}
          </Text>
          <Badge size="xs" variant="default">
            {attachmentLabel}
          </Badge>
        </Group>
        <Text size="xs" c="dimmed" ff="monospace">
          ID …{passkey.credential_id_short} · added {dayjs(passkey.created_at).fromNow()}
          {passkey.last_used ? ` · last used ${dayjs(passkey.last_used).fromNow()}` : ''}
        </Text>
      </Stack>
      <Tooltip label="Remove" withArrow>
        <ActionIcon
          variant="subtle"
          color="red"
          onClick={onDelete}
          disabled={!canUpdate}
          aria-label={`Remove ${passkey.name}`}
        >
          <IconTrash size={14} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

interface PasskeyRegisterModalProps {
  onClose: () => void;
  onRegister: (input: {
    name: string;
    attachment: AttachmentHint;
  }) => void;
}

function PasskeyRegisterModal({ onClose, onRegister }: PasskeyRegisterModalProps) {
  const [name, setName] = useState(suggestPasskeyName());
  const [attachment, setAttachment] = useState<AttachmentHint>('platform');
  const [registering, setRegistering] = useState(false);

  async function handleRegister() {
    if (name.trim().length === 0) {
      notify.error('Missing name', 'Give your passkey a memorable name.');
      return;
    }
    setRegistering(true);
    // Mock the WebAuthn ceremony with a small delay so the UX matches the
    // real flow (which prompts for biometric / security key interaction).
    await new Promise((resolve) => setTimeout(resolve, 600));
    onRegister({ name: name.trim(), attachment });
    setRegistering(false);
  }

  return (
    <Modal
      opened
      onClose={onClose}
      title="Register a new passkey"
      size="sm"
      transitionProps={{ duration: 0 }}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Your browser will prompt you to use the chosen authenticator. Stage-1 mock simulates
          the ceremony — no real WebAuthn call is made.
        </Text>
        <TextInput
          label="Name"
          placeholder="MacBook Touch ID"
          value={name}
          onChange={(e) => {
            setName(e.currentTarget.value);
          }}
          required
        />
        <Select
          label="Authenticator type"
          data={[
            { value: 'platform', label: 'On this device (Touch ID / Windows Hello)' },
            { value: 'cross-platform', label: 'Hardware security key (YubiKey, etc.)' },
          ]}
          value={attachment}
          onChange={(v) => {
            if (v === 'platform' || v === 'cross-platform') setAttachment(v);
          }}
          allowDeselect={false}
          leftSection={
            attachment === 'platform' ? (
              <IconDeviceMobile size={14} />
            ) : (
              <IconKey size={14} />
            )
          }
        />
        <Group justify="flex-end" gap="xs" mt="sm">
          <Button variant="default" onClick={onClose} disabled={registering}>
            Cancel
          </Button>
          <Button
            loading={registering}
            onClick={() => {
              void handleRegister();
            }}
            leftSection={<IconShieldCheck size={14} />}
          >
            Register
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function suggestPasskeyName(): string {
  if (typeof navigator === 'undefined') return 'My passkey';
  const ua = navigator.userAgent;
  if (/Macintosh/.test(ua)) return 'Mac · Touch ID';
  if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone / iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Windows/.test(ua)) return 'Windows · Hello';
  if (/Linux/.test(ua)) return 'Linux laptop';
  return 'My passkey';
}
