/**
 * <PromptCompletionView> — renders the prompt + completion blocks for a
 * trace with Shiki highlighting via the shared <CodeBlock>.
 *
 * Permission gating: when the current user lacks `ai-trace:read-sensitive`
 * both blocks are replaced with a `[redacted]` placeholder plus a Tooltip
 * explaining which permission unlocks the full text. The redacted view
 * still reports the character length so operators can confirm the record
 * is non-empty without reading its contents.
 */
import { Alert, Stack, Text, Tooltip } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { CodeBlock } from '@/components/code-block';
import { usePermission } from '@/hooks/use-permission';

interface PromptCompletionViewProps {
  prompt: string;
  completion: string;
}

/** Language hints — <CodeBlock> only loads a small subset of Shiki grammars
 *  (json/yaml/typescript/javascript/bash + `text` fallback). Markdown is NOT
 *  in that subset, so prompts render as plain text. Adding `markdown` would
 *  mean pulling a new grammar import in `components/code-block/index.tsx`
 *  and bloating the Shiki chunk — not worth it for the prompt block alone.
 *  Completions are free-form model output; plain text is also correct. */
const PROMPT_LANG = 'text' as const;
const COMPLETION_LANG = 'text' as const;

export function PromptCompletionView({ prompt, completion }: PromptCompletionViewProps) {
  const canRead = usePermission('ai-trace:read-sensitive');

  if (!canRead) {
    return (
      <Alert
        icon={<IconLock size={16} />}
        color="gray"
        variant="light"
        title="Prompt and completion hidden"
        data-testid="trace-redacted"
      >
        <Stack gap={4}>
          <Text size="xs">
            You need the{' '}
            <Tooltip
              label="Grant ai-trace:read-sensitive to surface prompt and completion bodies."
              withArrow
              multiline
              w={260}
            >
              <Text
                component="span"
                size="xs"
                ff="monospace"
                fw={600}
                style={{ textDecoration: 'underline dotted', cursor: 'help' }}
              >
                ai-trace:read-sensitive
              </Text>
            </Tooltip>{' '}
            permission to view the full prompt and completion.
          </Text>
          <Text size="xs" c="var(--mantine-color-gray-7)">
            [redacted — {String(prompt.length)} prompt chars, {String(completion.length)} completion
            chars]
          </Text>
        </Stack>
      </Alert>
    );
  }

  return (
    <Stack gap="sm" data-testid="trace-prompt-completion">
      <CodeBlock
        title="Prompt"
        code={prompt === '' ? '(empty)' : prompt}
        language={PROMPT_LANG}
        maxHeight={320}
      />
      <CodeBlock
        title="Completion"
        code={completion === '' ? '(empty)' : completion}
        language={COMPLETION_LANG}
        maxHeight={320}
      />
    </Stack>
  );
}
