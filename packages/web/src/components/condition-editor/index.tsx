/**
 * <ConditionEditor> — Monaco-backed CEL expression editor.
 *
 * Features:
 *   - Monaco editor with a minimal 'cel' language (syntax-highlighting)
 *   - 250ms debounced onChange + parseCel validation
 *   - Inline error markers via Monaco's setModelMarkers
 *   - Chrome text per spec §7.2 (exact phrasing)
 *
 * Monaco in jsdom: Monaco relies on browser APIs (ResizeObserver, workers,
 * document.createRange) that jsdom does not fully implement. Tests must
 * mock '@monaco-editor/react' with a trivial <textarea> component — see
 * index.test.tsx. This trade-off means the test exercises all non-Monaco
 * logic (debouncing, parseCel, chrome text, aria) but does not exercise
 * the Monaco widget itself in the unit-test environment.
 *
 * spec §7.2 / Task 1d.64
 */

import { useEffect, useRef, useCallback } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import { Text, Box, Stack } from '@mantine/core';
import { parseCel } from '../../lib/cel-parser';
import { registerCelLanguage } from './cel-language';
import type * as MonacoNS from 'monaco-editor';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConditionEditorProps {
  value: string;
  onChange: (v: string) => void;
  onValidityChange?: (ok: boolean) => void;
  label?: string;
  placeholder?: string;
  readOnly?: boolean;
  height?: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const CHROME_TEXT =
  'Syntax check by cel-js; the daemon is authoritative. Save to trigger full validation.';

const MARKER_OWNER = 'cel-condition-editor';

export function ConditionEditor({
  value,
  onChange,
  onValidityChange,
  label,
  placeholder,
  readOnly = false,
  height = 160,
}: ConditionEditorProps) {
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── debounced validation ────────────────────────────────────────────────────
  const validate = useCallback(
    async (source: string) => {
      const result = await parseCel(source);
      const editor = editorRef.current;
      const monaco = monacoRef.current;
      if (!editor || !monaco) return;

      const model = editor.getModel();
      if (!model) return;

      if (result.ok) {
        monaco.editor.setModelMarkers(model, MARKER_OWNER, []);
        onValidityChange?.(true);
      } else {
        const line = result.line ?? 1;
        const col = result.col ?? 1;
        monaco.editor.setModelMarkers(model, MARKER_OWNER, [
          {
            severity: monaco.MarkerSeverity.Error,
            message: result.error,
            startLineNumber: line,
            startColumn: col,
            endLineNumber: line,
            endColumn: col + 1,
          },
        ]);
        onValidityChange?.(false);
      }
    },
    [onValidityChange],
  );

  // ── cleanup debounce on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // ── Monaco mount handler ────────────────────────────────────────────────────
  const handleMount: OnMount = useCallback(
    (editor, monaco) => {
      editorRef.current = editor;

      monacoRef.current = monaco as typeof MonacoNS;
      registerCelLanguage(monaco as typeof MonacoNS);

      // Trigger an initial validation pass
      void validate(value);
    },
    [value, validate],
  );

  // ── value change handler ────────────────────────────────────────────────────
  const handleChange = useCallback(
    (v: string | undefined) => {
      const next = v ?? '';
      onChange(next);

      if (debounceRef.current !== null) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        void validate(next);
      }, 250);
    },
    [onChange, validate],
  );

  return (
    <Stack gap="xs">
      {label && (
        <Text size="sm" fw={500}>
          {label}
        </Text>
      )}

      {/* spec §7.2 exact phrasing */}
      <Text size="xs" c="dimmed" aria-label="cel-editor-chrome">
        {CHROME_TEXT}
      </Text>

      <Box
        style={{
          border: '1px solid var(--mantine-color-default-border)',
          borderRadius: 'var(--mantine-radius-sm)',
          overflow: 'hidden',
        }}
      >
        <Editor
          height={height}
          language="cel"
          value={value}
          onChange={handleChange}
          onMount={handleMount}
          options={{
            readOnly,
            minimap: { enabled: false },
            lineNumbers: 'on',
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            fontSize: 13,
            tabSize: 2,
            placeholder: placeholder,
            automaticLayout: true,
          }}
          theme="vs-dark"
        />
      </Box>
    </Stack>
  );
}
