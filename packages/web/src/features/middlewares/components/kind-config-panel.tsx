/**
 * <KindConfigPanel> — per-kind config editor for a middleware.
 *
 * Renders different form fields depending on `kind`:
 *   rate-limit, auth, transform, cors, cache, logging, custom
 *
 * The `value` prop is the current config object; `onChange` receives a new
 * config object. For simple kinds (rate-limit, auth, cache, logging, cors)
 * the component renders strongly-typed Mantine inputs. For transform + custom
 * it falls back to a JSON textarea.
 */
import { useState } from 'react';
import {
  Stack,
  TextInput,
  NumberInput,
  Select,
  Textarea,
  Switch,
  MultiSelect,
  Text,
  Alert,
} from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import type { Middleware } from '@/api/resources/types';

interface KindConfigPanelProps {
  kind: Middleware['kind'];
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
function asStringArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}
function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function KindConfigPanel({
  kind,
  value,
  onChange,
  readOnly = false,
}: KindConfigPanelProps) {
  if (kind === 'rate-limit') {
    return (
      <Stack gap="sm">
        <NumberInput
          label="Requests per minute"
          min={1}
          max={100_000}
          disabled={readOnly}
          value={asNumber(value.requests_per_minute, 60)}
          onChange={(v) => {
            onChange({ ...value, requests_per_minute: typeof v === 'number' ? v : 60 });
          }}
        />
        <NumberInput
          label="Burst"
          min={0}
          disabled={readOnly}
          value={asNumber(value.burst, 0)}
          onChange={(v) => {
            onChange({ ...value, burst: typeof v === 'number' ? v : 0 });
          }}
        />
        <Select
          label="Key by"
          data={[
            { value: 'ip', label: 'IP' },
            { value: 'user', label: 'User' },
            { value: 'api-key', label: 'API key' },
            { value: 'header', label: 'Header' },
          ]}
          value={asString(value.key_by, 'ip')}
          disabled={readOnly}
          allowDeselect={false}
          onChange={(v) => {
            onChange({ ...value, key_by: v ?? 'ip' });
          }}
        />
        {asString(value.key_by) === 'header' && (
          <TextInput
            label="Header name"
            placeholder="X-Api-Key"
            disabled={readOnly}
            value={asString(value.header_name)}
            onChange={(e) => {
              onChange({ ...value, header_name: e.currentTarget.value });
            }}
          />
        )}
      </Stack>
    );
  }

  if (kind === 'auth') {
    return (
      <Stack gap="sm">
        <Select
          label="Mode"
          data={[
            { value: 'bearer', label: 'Bearer' },
            { value: 'basic', label: 'Basic' },
            { value: 'api-key', label: 'API key' },
            { value: 'mtls', label: 'Mutual TLS' },
          ]}
          value={asString(value.mode, 'bearer')}
          disabled={readOnly}
          allowDeselect={false}
          onChange={(v) => {
            onChange({ ...value, mode: v ?? 'bearer' });
          }}
        />
        <TextInput
          label="Required scope (optional)"
          placeholder="read:users"
          disabled={readOnly}
          value={asString(value.required_scope)}
          onChange={(e) => {
            onChange({ ...value, required_scope: e.currentTarget.value });
          }}
        />
      </Stack>
    );
  }

  if (kind === 'cors') {
    return (
      <Stack gap="sm">
        <MultiSelect
          label="Allowed origins"
          placeholder="https://example.com"
          data={asStringArray(value.allowed_origins)}
          searchable
          disabled={readOnly}
          value={asStringArray(value.allowed_origins)}
          onChange={(next) => {
            onChange({ ...value, allowed_origins: next });
          }}
        />
        <MultiSelect
          label="Allowed methods"
          data={[
            { value: 'GET', label: 'GET' },
            { value: 'POST', label: 'POST' },
            { value: 'PUT', label: 'PUT' },
            { value: 'PATCH', label: 'PATCH' },
            { value: 'DELETE', label: 'DELETE' },
            { value: 'OPTIONS', label: 'OPTIONS' },
            { value: 'HEAD', label: 'HEAD' },
          ]}
          disabled={readOnly}
          value={asStringArray(value.allowed_methods)}
          onChange={(next) => {
            onChange({ ...value, allowed_methods: next });
          }}
        />
        <Switch
          label="Allow credentials"
          disabled={readOnly}
          checked={asBool(value.allow_credentials)}
          onChange={(e) => {
            onChange({ ...value, allow_credentials: e.currentTarget.checked });
          }}
        />
      </Stack>
    );
  }

  if (kind === 'cache') {
    return (
      <Stack gap="sm">
        <NumberInput
          label="TTL (seconds)"
          min={1}
          disabled={readOnly}
          value={asNumber(value.ttl_seconds, 60)}
          onChange={(v) => {
            onChange({ ...value, ttl_seconds: typeof v === 'number' ? v : 60 });
          }}
        />
        <MultiSelect
          label="Vary headers"
          placeholder="Accept, Authorization"
          data={asStringArray(value.vary_headers)}
          searchable
          disabled={readOnly}
          value={asStringArray(value.vary_headers)}
          onChange={(next) => {
            onChange({ ...value, vary_headers: next });
          }}
        />
      </Stack>
    );
  }

  if (kind === 'logging') {
    return (
      <Stack gap="sm">
        <Select
          label="Level"
          data={[
            { value: 'debug', label: 'Debug' },
            { value: 'info', label: 'Info' },
            { value: 'warn', label: 'Warn' },
            { value: 'error', label: 'Error' },
          ]}
          value={asString(value.level, 'info')}
          disabled={readOnly}
          allowDeselect={false}
          onChange={(v) => {
            onChange({ ...value, level: v ?? 'info' });
          }}
        />
        <MultiSelect
          label="Fields"
          placeholder="method, path, status"
          data={asStringArray(value.fields)}
          searchable
          disabled={readOnly}
          value={asStringArray(value.fields)}
          onChange={(next) => {
            onChange({ ...value, fields: next });
          }}
        />
      </Stack>
    );
  }

  // transform or custom — raw JSON editor
  return <JsonConfigEditor value={value} onChange={onChange} readOnly={readOnly} kind={kind} />;
}

function JsonConfigEditor({
  value,
  onChange,
  readOnly,
  kind,
}: {
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  readOnly?: boolean;
  kind: Middleware['kind'];
}) {
  const initialSerialized = JSON.stringify(value, null, 2);
  const [lastSerialized, setLastSerialized] = useState(initialSerialized);
  const [draft, setDraft] = useState(initialSerialized);
  const [parseError, setParseError] = useState<string | null>(null);

  // If the external value changes from elsewhere, reset the draft.
  // Compare during render and call setState once (React will re-render with new state).
  if (lastSerialized !== initialSerialized) {
    setLastSerialized(initialSerialized);
    setDraft(initialSerialized);
    setParseError(null);
  }

  return (
    <Stack gap="xs">
      <Text size="sm" fw={500}>
        Config ({kind})
      </Text>
      {parseError && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={14} />} p="xs">
          <Text size="xs">{parseError}</Text>
        </Alert>
      )}
      <Textarea
        autosize
        minRows={6}
        maxRows={20}
        ff="monospace"
        disabled={readOnly === true}
        value={draft}
        onChange={(e) => {
          const next = e.currentTarget.value;
          setDraft(next);
          try {
            const parsed: unknown = JSON.parse(next);
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
              setParseError('Config must be a JSON object');
              return;
            }
            setParseError(null);
            onChange(parsed as Record<string, unknown>);
          } catch (err) {
            setParseError(err instanceof Error ? err.message : 'Invalid JSON');
          }
        }}
      />
    </Stack>
  );
}
