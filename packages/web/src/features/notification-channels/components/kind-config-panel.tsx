/**
 * <ChannelKindConfigPanel> — per-kind config editor for a notification channel.
 *
 * Renders different form fields depending on `kind`:
 *   email, slack, webhook, pagerduty, teams, sms
 *
 * Password-type inputs are used for secret-like fields (passwords, tokens,
 * routing keys). Webhook headers are edited as a list of key/value pairs —
 * rows can be added and removed.
 */
import { useMemo } from 'react';
import {
  ActionIcon,
  Badge,
  Group,
  NumberInput,
  PasswordInput,
  Stack,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import type { NotificationChannel } from '@/api/resources/types';

interface ChannelKindConfigPanelProps {
  kind: NotificationChannel['kind'];
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  /** When true, render everything as read-only text. */
  readOnly?: boolean;
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' ? v : fallback;
}
function asStringRecord(v: unknown): Record<string, string> {
  if (typeof v !== 'object' || v === null) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}

export function ChannelKindConfigPanel({
  kind,
  value,
  onChange,
  readOnly = false,
}: ChannelKindConfigPanelProps) {
  if (kind === 'email') {
    return (
      <Stack gap="sm">
        <TextInput
          label="To address"
          placeholder="alerts@example.com"
          required
          disabled={readOnly}
          value={asString(value.to)}
          onChange={(e) => {
            onChange({ ...value, to: e.currentTarget.value });
          }}
        />
        <TextInput
          label="From address"
          placeholder="noreply@example.com"
          required
          disabled={readOnly}
          value={asString(value.from)}
          onChange={(e) => {
            onChange({ ...value, from: e.currentTarget.value });
          }}
        />
        <TextInput
          label="SMTP host"
          placeholder="smtp.example.com"
          disabled={readOnly}
          value={asString(value.smtp_host)}
          onChange={(e) => {
            onChange({ ...value, smtp_host: e.currentTarget.value });
          }}
        />
        <NumberInput
          label="SMTP port"
          min={1}
          max={65535}
          disabled={readOnly}
          value={asNumber(value.smtp_port, 587)}
          onChange={(v) => {
            onChange({ ...value, smtp_port: typeof v === 'number' ? v : 587 });
          }}
        />
        <TextInput
          label="SMTP user"
          disabled={readOnly}
          value={asString(value.smtp_user)}
          onChange={(e) => {
            onChange({ ...value, smtp_user: e.currentTarget.value });
          }}
        />
        <PasswordInput
          label="SMTP password"
          disabled={readOnly}
          value={asString(value.smtp_password)}
          onChange={(e) => {
            onChange({ ...value, smtp_password: e.currentTarget.value });
          }}
        />
      </Stack>
    );
  }

  if (kind === 'slack') {
    return (
      <Stack gap="sm">
        <TextInput
          label="Webhook URL"
          placeholder="https://hooks.slack.com/services/…"
          required
          disabled={readOnly}
          value={asString(value.webhook_url)}
          onChange={(e) => {
            onChange({ ...value, webhook_url: e.currentTarget.value });
          }}
        />
      </Stack>
    );
  }

  if (kind === 'webhook') {
    return (
      <Stack gap="sm">
        <TextInput
          label="URL"
          placeholder="https://example.com/webhook"
          required
          disabled={readOnly}
          value={asString(value.url)}
          onChange={(e) => {
            onChange({ ...value, url: e.currentTarget.value });
          }}
        />
        <Group gap="xs" align="center">
          <Text size="sm" fw={500}>
            Method
          </Text>
          <Badge size="sm" variant="light" color="gray">
            POST
          </Badge>
        </Group>
        <WebhookHeaderEditor
          headers={asStringRecord(value.headers)}
          onChange={(headers) => {
            onChange({ ...value, headers });
          }}
          readOnly={readOnly}
        />
      </Stack>
    );
  }

  if (kind === 'pagerduty') {
    return (
      <Stack gap="sm">
        <PasswordInput
          label="Routing key"
          placeholder="Integration key"
          required
          disabled={readOnly}
          value={asString(value.routing_key)}
          onChange={(e) => {
            onChange({ ...value, routing_key: e.currentTarget.value });
          }}
        />
      </Stack>
    );
  }

  if (kind === 'teams') {
    return (
      <Stack gap="sm">
        <TextInput
          label="Webhook URL"
          placeholder="https://outlook.office.com/webhook/…"
          required
          disabled={readOnly}
          value={asString(value.webhook_url)}
          onChange={(e) => {
            onChange({ ...value, webhook_url: e.currentTarget.value });
          }}
        />
      </Stack>
    );
  }

  // sms
  return (
    <Stack gap="sm">
      <TextInput
        label="Twilio SID"
        placeholder="AC…"
        disabled={readOnly}
        value={asString(value.twilio_sid)}
        onChange={(e) => {
          onChange({ ...value, twilio_sid: e.currentTarget.value });
        }}
      />
      <PasswordInput
        label="Twilio auth token"
        disabled={readOnly}
        value={asString(value.twilio_token)}
        onChange={(e) => {
          onChange({ ...value, twilio_token: e.currentTarget.value });
        }}
      />
      <TextInput
        label="From number"
        placeholder="+15555550123"
        disabled={readOnly}
        value={asString(value.from_number)}
        onChange={(e) => {
          onChange({ ...value, from_number: e.currentTarget.value });
        }}
      />
    </Stack>
  );
}

// ─── Webhook headers sub-editor ──────────────────────────────────────────────

function WebhookHeaderEditor({
  headers,
  onChange,
  readOnly,
}: {
  headers: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  readOnly: boolean;
}) {
  const entries = useMemo(() => Object.entries(headers), [headers]);

  function setRow(oldKey: string, nextKey: string, nextValue: string) {
    // Preserve insertion order by rebuilding from entries.
    const next: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k === oldKey) {
        if (nextKey !== '') next[nextKey] = nextValue;
      } else {
        next[k] = v;
      }
    }
    onChange(next);
  }

  function removeRow(key: string) {
    const next: Record<string, string> = {};
    for (const [k, v] of entries) {
      if (k !== key) next[k] = v;
    }
    onChange(next);
  }

  function addRow() {
    // Find a free placeholder key so the caller can type into it.
    let candidate = 'header';
    let i = 1;
    while (candidate in headers) {
      candidate = `header-${String(i)}`;
      i += 1;
    }
    onChange({ ...headers, [candidate]: '' });
  }

  return (
    <Stack gap={4}>
      <Text size="sm" fw={500}>
        Headers
      </Text>
      {entries.length === 0 ? (
        <Text size="xs" c="var(--mantine-color-gray-7)">
          No headers set.
        </Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Name</Table.Th>
              <Table.Th>Value</Table.Th>
              <Table.Th style={{ width: 60 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {entries.map(([k, v]) => (
              <Table.Tr key={k}>
                <Table.Td>
                  <TextInput
                    size="xs"
                    value={k}
                    disabled={readOnly}
                    onChange={(e) => {
                      setRow(k, e.currentTarget.value, v);
                    }}
                    aria-label={`Header name for ${k}`}
                  />
                </Table.Td>
                <Table.Td>
                  <TextInput
                    size="xs"
                    value={v}
                    disabled={readOnly}
                    onChange={(e) => {
                      setRow(k, k, e.currentTarget.value);
                    }}
                    aria-label={`Header value for ${k}`}
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="red.8"
                    disabled={readOnly}
                    aria-label={`Remove header ${k}`}
                    onClick={() => {
                      removeRow(k);
                    }}
                  >
                    <IconTrash size={12} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      {!readOnly && (
        <ActionIcon variant="subtle" size="sm" aria-label="Add header" onClick={addRow}>
          <IconPlus size={14} />
        </ActionIcon>
      )}
    </Stack>
  );
}
