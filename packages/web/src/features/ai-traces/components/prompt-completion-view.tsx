/**
 * <PromptCompletionView> — renders the prompt + completion blocks for a
 * trace with Shiki highlighting via the shared <CodeBlock>.
 *
 * Stage-2: gating is driven by the explicit `unmasked` prop. The daemon
 * redacts prompts/completions by default (returning `null`) and only
 * surfaces them through the `/reveal` endpoint, which the parent invokes
 * when the operator confirms a justified reveal. The view itself stays
 * dumb — when `unmasked === true` it shows the (already-fetched) text;
 * otherwise it renders a "redacted" placeholder advising the operator
 * how to surface the bodies.
 */
import { Alert, Stack, Text, Tooltip } from '@mantine/core';
import { IconLock } from '@tabler/icons-react';
import { CodeBlock } from '@/components/code-block';

interface PromptCompletionViewProps {
  prompt: string;
  completion: string;
  /** When true, render the prompt + completion bodies verbatim. Default: false. */
  unmasked?: boolean;
}

const PROMPT_LANG = 'text' as const;
const COMPLETION_LANG = 'text' as const;

export function PromptCompletionView({
  prompt,
  completion,
  unmasked = false,
}: PromptCompletionViewProps) {
  if (!unmasked) {
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
            permission and an audited reveal to view the full prompt and completion.
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
