/**
 * <JsonSchemaEditor> — Mantine JsonInput wrapper with blur-time validation.
 *
 * Validates that the input parses to a JSON object (schema root must be an
 * object). Shows an inline error when invalid. The caller binds the current
 * value (as an object) via props; the component internally keeps a string
 * draft for free-typing.
 */
import { useEffect, useState } from 'react';
import { JsonInput, Stack, Text } from '@mantine/core';

interface JsonSchemaEditorProps {
  label?: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  onValidityChange?: (valid: boolean) => void;
  minRows?: number;
}

function stringify(v: Record<string, unknown>): string {
  return JSON.stringify(v, null, 2);
}

export function JsonSchemaEditor({
  label = 'JSON schema',
  value,
  onChange,
  onValidityChange,
  minRows = 10,
}: JsonSchemaEditorProps) {
  const [draft, setDraft] = useState<string>(() => stringify(value));
  const [error, setError] = useState<string | null>(null);

  // When the parent value changes (e.g. edit-mode switch), sync the draft.
  useEffect(() => {
    setDraft(stringify(value));
  }, [value]);

  function validateAndCommit(text: string) {
    if (text.trim() === '') {
      setError('Schema is required');
      onValidityChange?.(false);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        setError('Schema root must be an object');
        onValidityChange?.(false);
        return;
      }
      setError(null);
      onValidityChange?.(true);
      onChange(parsed as Record<string, unknown>);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON';
      setError(msg);
      onValidityChange?.(false);
    }
  }

  return (
    <Stack gap={4}>
      <JsonInput
        label={label}
        value={draft}
        onChange={setDraft}
        onBlur={() => {
          validateAndCommit(draft);
        }}
        minRows={minRows}
        formatOnBlur
        validationError={error ?? undefined}
        aria-label="JSON schema editor"
      />
      {error && (
        <Text size="xs" c="red">
          {error}
        </Text>
      )}
    </Stack>
  );
}
