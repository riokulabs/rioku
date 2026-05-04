/**
 * <CodeBlock> — shiki-backed syntax highlighter.
 *
 * Loaded grammars: json, yaml, typescript, javascript, bash, text (fallback).
 * Themes: vitesse-dark (dark mode) / vitesse-light (light mode).
 *
 * shiki is lazy-loaded on first mount to keep the initial bundle slim. It lands
 * in the dedicated "shiki" Rollup chunk defined in vite.config.ts.
 *
 * Props:
 *   code       — source string to highlight
 *   language   — one of the loaded grammars (defaults to "text")
 *   title      — optional header label shown above the code
 *   copyable   — show a copy-to-clipboard button (default: true)
 *   maxHeight  — max-height in px before the content scrolls (default: none)
 */
import { useEffect, useState } from 'react';
import {
  Paper,
  Group,
  Text,
  CopyButton,
  ActionIcon,
  Tooltip,
  Box,
  ScrollArea,
} from '@mantine/core';
import { useMantineColorScheme } from '@mantine/core';
import { IconCopy, IconCheck } from '@tabler/icons-react';

// ── Supported languages ───────────────────────────────────────────────────────

export type SupportedLanguage = 'json' | 'yaml' | 'typescript' | 'javascript' | 'bash' | 'text';

// ── Shiki lazy-loader (singleton promise) ─────────────────────────────────────

let shikiPromise: Promise<(code: string, lang: SupportedLanguage, theme: string) => string> | null =
  null;

function loadShiki(): Promise<(code: string, lang: SupportedLanguage, theme: string) => string> {
  shikiPromise ??= (async () => {
    // Use createHighlighterCore from shiki/core + individual language dynamic imports.
    // This avoids the full shiki bundle (~1600 KB gzipped); only the grammars we
    // actually need are loaded (~250–300 KB gzipped total).
    const [
      { createHighlighterCore },
      { createJavaScriptRegexEngine },
      langJson,
      langYaml,
      langTs,
      langJs,
      langBash,
    ] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/yaml.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/bash.mjs'),
    ]);
    const highlighter = await createHighlighterCore({
      themes: [import('shiki/themes/vitesse-dark.mjs'), import('shiki/themes/vitesse-light.mjs')],
      langs: [langJson.default, langYaml.default, langTs.default, langJs.default, langBash.default],
      engine: createJavaScriptRegexEngine(),
    });
    return (code: string, lang: SupportedLanguage, theme: string): string => {
      const resolvedLang = lang === 'text' ? 'bash' : lang;
      return highlighter.codeToHtml(code, { lang: resolvedLang, theme });
    };
  })();
  return shikiPromise;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface CodeBlockProps {
  code: string;
  language?: SupportedLanguage;
  title?: string;
  copyable?: boolean;
  maxHeight?: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function CodeBlock({
  code,
  language = 'text',
  title,
  copyable = true,
  maxHeight,
}: CodeBlockProps) {
  const { colorScheme } = useMantineColorScheme();
  const theme = colorScheme === 'dark' ? 'vitesse-dark' : 'vitesse-light';

  // Track the most recent render key so stale async results are discarded.
  const renderKey = `${code}::${language}::${theme}`;
  const [renderState, setRenderState] = useState<{
    key: string;
    html: string | null;
    error: boolean;
  }>({ key: renderKey, html: null, error: false });

  // Reset when the key changes — use functional update to avoid stale closure.
  useEffect(() => {
    let active = true;
    void loadShiki()
      .then((highlight) => {
        if (!active) return;
        setRenderState({ key: renderKey, html: highlight(code, language, theme), error: false });
      })
      .catch(() => {
        if (!active) return;
        setRenderState({ key: renderKey, html: null, error: true });
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderKey]);

  // If renderState is stale (key changed), treat as loading.
  const html = renderState.key === renderKey ? renderState.html : null;
  const error = renderState.key === renderKey ? renderState.error : false;

  const hasTitle = Boolean(title);
  const showCopy = copyable;

  return (
    <Paper withBorder radius="sm" style={{ overflow: 'hidden' }} data-testid="code-block">
      {/* ── Header bar ──────────────────────────────────────────────────── */}
      {(hasTitle || showCopy) && (
        <Group
          justify="space-between"
          align="center"
          px="sm"
          py={6}
          style={(theme) => ({
            borderBottom: `1px solid ${theme.colors.gray[3]}`,
            backgroundColor: theme.colors.gray[0],
          })}
        >
          {hasTitle ? (
            <Text size="xs" fw={500} c="var(--mantine-color-gray-7)" ff="monospace">
              {title}
            </Text>
          ) : (
            <span />
          )}

          {showCopy && (
            <CopyButton value={code} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip label={copied ? 'Copied!' : 'Copy code'} withArrow>
                  <ActionIcon
                    size="xs"
                    variant="subtle"
                    color={copied ? 'teal' : 'gray'}
                    onClick={copy}
                    aria-label={copied ? 'Copied' : 'Copy code'}
                  >
                    {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          )}
        </Group>
      )}

      {/* ── Code body ───────────────────────────────────────────────────── */}
      <ScrollArea style={maxHeight ? { maxHeight: `${String(maxHeight)}px` } : undefined}>
        {error ? (
          /* Fallback: plain <pre> if shiki fails to load */
          <Box
            component="pre"
            p="sm"
            m={0}
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              whiteSpace: 'pre',
              overflowX: 'auto',
            }}
            data-testid="code-block-fallback"
          >
            {code}
          </Box>
        ) : html ? (
          <Box
            // shiki emits a full <pre><code>…</code></pre> with inline styles
            dangerouslySetInnerHTML={{ __html: html }}
            style={{
              fontSize: 13,
              lineHeight: 1.5,
            }}
            data-testid="code-block-highlighted"
          />
        ) : (
          /* Skeleton while shiki loads — plain pre preserves layout */
          <Box
            component="pre"
            p="sm"
            m={0}
            style={{
              fontFamily: 'monospace',
              fontSize: 13,
              whiteSpace: 'pre',
              color: 'transparent',
              userSelect: 'none',
            }}
            aria-hidden="true"
            data-testid="code-block-loading"
          >
            {code}
          </Box>
        )}
      </ScrollArea>
    </Paper>
  );
}
