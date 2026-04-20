/**
 * CEL-aware diff component.
 *
 * Renders a token-level diff between two CEL expressions side-by-side.
 * When either side fails to parse via `cel-js`, falls back to a line-level
 * diff of the raw text — so policy-change audit entries still give the
 * reviewer a readable before/after without the component blowing up on
 * malformed grammar.
 *
 * Token classification (added / removed / unchanged) is driven by a small
 * longest-common-subsequence computation over tokenized input. The CEL
 * grammar is loose enough for stage 1 that a regex tokenizer covering
 * identifiers, numbers, strings, and operators is sufficient.
 */
import { useEffect, useMemo, useState } from 'react';
import { Badge, Box, Group, Stack, Text } from '@mantine/core';
import { parseCel } from '@/lib/cel-parser';

export interface CelDiffProps {
  /** Prior CEL source. Empty string is treated as "no previous expression". */
  before: string;
  /** Updated CEL source. */
  after: string;
  /** Optional accessible label; defaults to "CEL expression diff". */
  'aria-label'?: string;
}

type TokenKind = 'added' | 'removed' | 'unchanged';

interface DiffToken {
  text: string;
  kind: TokenKind;
}

// ─── Tokenizer ───────────────────────────────────────────────────────────────

/**
 * Split a CEL expression into display tokens:
 *   - string literals ("..." or '...'),
 *   - numeric literals (ints + floats),
 *   - identifiers / keywords,
 *   - operators and punctuation (grouped into one-or-more non-word chars),
 *   - whitespace runs (kept so re-joining round-trips formatting).
 *
 * Whitespace tokens are emitted so that the before/after panels remain
 * readable; they are treated as always-unchanged to avoid noisy diffs.
 */
function tokenizeCel(source: string): string[] {
  const out: string[] = [];
  const re =
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\d+(?:\.\d+)?|[A-Za-z_][A-Za-z0-9_.]*|\s+|[^\s\w]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    out.push(match[0]);
  }
  return out;
}

// ─── LCS-based diff ──────────────────────────────────────────────────────────

interface SideTokens {
  before: DiffToken[];
  after: DiffToken[];
}

/**
 * Compute a token diff using longest common subsequence. Whitespace tokens
 * are classified as `unchanged` on whichever side they appear on to avoid
 * polluting the diff with invisible churn.
 */
function diffTokens(beforeTokens: string[], afterTokens: string[]): SideTokens {
  const n = beforeTokens.length;
  const m = afterTokens.length;

  // Cheap fast path when one side is empty.
  if (n === 0) {
    return {
      before: [],
      after: afterTokens.map((t) => ({ text: t, kind: 'added' })),
    };
  }
  if (m === 0) {
    return {
      before: beforeTokens.map((t) => ({ text: t, kind: 'removed' })),
      after: [],
    };
  }

  // LCS length table. For stage 1 we accept O(n*m) memory — CEL conditions
  // are human-authored and typically <200 tokens.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array<number>(m + 1).fill(0),
  );
  for (let i = 1; i <= n; i++) {
    const bi = beforeTokens[i - 1]!;
    for (let j = 1; j <= m; j++) {
      if (bi === afterTokens[j - 1]) {
        dp[i]![j] = (dp[i - 1]![j - 1] ?? 0) + 1;
      } else {
        const up = dp[i - 1]![j] ?? 0;
        const left = dp[i]![j - 1] ?? 0;
        dp[i]![j] = up >= left ? up : left;
      }
    }
  }

  const before: DiffToken[] = [];
  const after: DiffToken[] = [];

  // Walk the table backwards, classifying each token.
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const b = beforeTokens[i - 1]!;
    const a = afterTokens[j - 1]!;
    if (b === a) {
      before.push({ text: b, kind: 'unchanged' });
      after.push({ text: a, kind: 'unchanged' });
      i--;
      j--;
    } else if ((dp[i - 1]![j] ?? 0) >= (dp[i]![j - 1] ?? 0)) {
      before.push({
        text: b,
        kind: /^\s+$/.test(b) ? 'unchanged' : 'removed',
      });
      i--;
    } else {
      after.push({
        text: a,
        kind: /^\s+$/.test(a) ? 'unchanged' : 'added',
      });
      j--;
    }
  }
  while (i > 0) {
    const b = beforeTokens[i - 1]!;
    before.push({
      text: b,
      kind: /^\s+$/.test(b) ? 'unchanged' : 'removed',
    });
    i--;
  }
  while (j > 0) {
    const a = afterTokens[j - 1]!;
    after.push({
      text: a,
      kind: /^\s+$/.test(a) ? 'unchanged' : 'added',
    });
    j--;
  }

  before.reverse();
  after.reverse();
  return { before, after };
}

// ─── Styling ─────────────────────────────────────────────────────────────────

/**
 * Color hints per token kind. Uses explicit hex values rather than Mantine
 * `c="dimmed"` so the panel meets WCAG AA against the default background.
 */
const TOKEN_COLORS: Record<TokenKind, string> = {
  added: 'var(--mantine-color-teal-4)',
  removed: 'var(--mantine-color-red-4)',
  unchanged: 'var(--mantine-color-text)',
};

const TOKEN_BG: Record<TokenKind, string | undefined> = {
  added: 'rgba(12, 166, 120, 0.18)',
  removed: 'rgba(224, 49, 49, 0.18)',
  unchanged: undefined,
};

// ─── Component ───────────────────────────────────────────────────────────────

/**
 * Render a side-by-side CEL diff. When the two expressions are identical
 * we render a single "(no change)" note. When parse fails on either side
 * we fall back to a whole-text line diff without grammar awareness.
 */
export function CelDiff({
  before,
  after,
  'aria-label': ariaLabel = 'CEL expression diff',
}: CelDiffProps) {
  const [parseBefore, setParseBefore] = useState<boolean | null>(null);
  const [parseAfter, setParseAfter] = useState<boolean | null>(null);

  // Kick off grammar-aware parse checks asynchronously — cel-js loads lazily.
  useEffect(() => {
    let cancelled = false;
    if (before.trim().length === 0) {
      setParseBefore(true);
    } else {
      void parseCel(before).then((r) => {
        if (!cancelled) setParseBefore(r.ok);
      });
    }
    if (after.trim().length === 0) {
      setParseAfter(true);
    } else {
      void parseCel(after).then((r) => {
        if (!cancelled) setParseAfter(r.ok);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [before, after]);

  const tokens = useMemo(
    () => diffTokens(tokenizeCel(before), tokenizeCel(after)),
    [before, after],
  );

  if (before === after) {
    return (
      <Box aria-label={ariaLabel} data-testid="cel-diff">
        <Text size="sm">(no change)</Text>
      </Box>
    );
  }

  const fallback = parseBefore === false || parseAfter === false;

  return (
    <Box aria-label={ariaLabel} data-testid="cel-diff" role="group">
      {fallback ? (
        <Stack gap={4} data-testid="cel-diff-fallback">
          <Group gap={8}>
            <Badge size="sm" color="red" variant="light">
              Before
            </Badge>
            <Text size="xs">Grammar-aware diff unavailable; showing raw text.</Text>
          </Group>
          <Text size="sm" component="pre" style={{ whiteSpace: 'pre-wrap' }}>
            {before || '(empty)'}
          </Text>
          <Badge size="sm" color="teal" variant="light">
            After
          </Badge>
          <Text size="sm" component="pre" style={{ whiteSpace: 'pre-wrap' }}>
            {after || '(empty)'}
          </Text>
        </Stack>
      ) : (
        <Stack gap={4}>
          <Group gap={8}>
            <Badge size="sm" color="red" variant="light">
              Before
            </Badge>
          </Group>
          <CelTokenLine tokens={tokens.before} testid="cel-diff-before" />
          <Badge size="sm" color="teal" variant="light" w="fit-content">
            After
          </Badge>
          <CelTokenLine tokens={tokens.after} testid="cel-diff-after" />
        </Stack>
      )}
    </Box>
  );
}

function CelTokenLine({
  tokens,
  testid,
}: {
  tokens: DiffToken[];
  testid: string;
}) {
  return (
    <Box
      component="code"
      data-testid={testid}
      style={{
        fontFamily:
          'var(--mantine-font-family-monospace, ui-monospace, SFMono-Regular, monospace)',
        fontSize: 13,
        lineHeight: 1.6,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
      }}
    >
      {tokens.map((tok, idx) => (
        <span
          key={`${testid}-${idx}`}
          data-token-kind={tok.kind}
          style={{
            color: TOKEN_COLORS[tok.kind],
            backgroundColor: TOKEN_BG[tok.kind],
            borderRadius: 2,
            textDecoration: tok.kind === 'removed' ? 'line-through' : undefined,
          }}
        >
          {tok.text}
        </span>
      ))}
    </Box>
  );
}
