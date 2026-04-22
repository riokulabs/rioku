/**
 * <Simulator> — candidate-text input + "Simulate" button.
 *
 * Calls `simulateMatch(ruleId, text)` and renders:
 *   - Match / No match Badge
 *   - Score Progress bar relative to the rule's similarity_threshold
 *   - Matched exemplar Chip (when score > 0)
 */
import { useState } from 'react';
import { Badge, Button, Group, Progress, Stack, Text, Textarea } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useMockStore } from '@/api/mock-store';
import { simulateMatch } from '../api';
import type { SimulateMatchResult } from '../types';

interface SimulatorProps {
  ruleId: string;
}

export function Simulator({ ruleId }: SimulatorProps) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<SimulateMatchResult | null>(null);
  const [simulating, setSimulating] = useState(false);

  const rule = useMockStore((s) => s.aiSemanticRateLimits[ruleId]);

  function handleSimulate() {
    if (!rule) return;
    if (input.trim() === '') return;
    setSimulating(true);
    try {
      const r = simulateMatch(ruleId, input);
      setResult(r);
    } finally {
      setSimulating(false);
    }
  }

  const threshold = rule?.similarity_threshold ?? 0;
  const scorePct = result ? Math.min(100, Math.round(result.score * 100)) : 0;
  const thresholdPct = Math.round(threshold * 100);

  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        Simulator
      </Text>
      <Textarea
        placeholder="Paste a candidate prompt or message to test against the rule…"
        minRows={3}
        maxRows={8}
        value={input}
        onChange={(e) => {
          setInput(e.currentTarget.value);
        }}
        aria-label="Simulator candidate text"
      />
      <Group justify="flex-end">
        <Button
          size="xs"
          leftSection={<IconPlayerPlay size={14} />}
          loading={simulating}
          disabled={input.trim() === '' || !rule}
          onClick={handleSimulate}
        >
          Simulate
        </Button>
      </Group>

      <div role="status" aria-live="polite">
        {result && (
          <Stack gap={6}>
            <Group gap="xs">
              <Badge color={result.matched ? 'red' : 'green'} variant="light" size="sm">
                {result.matched ? 'Match' : 'No match'}
              </Badge>
              <Text size="xs" c="var(--mantine-color-gray-7)">
                score {result.score.toFixed(3)} · threshold {threshold.toFixed(3)}
              </Text>
            </Group>
            <Progress.Root size="md">
              <Progress.Section
                value={scorePct}
                color={result.matched ? 'red' : 'blue'}
                aria-label={`Similarity ${String(scorePct)} percent`}
              />
              <Progress.Section value={Math.max(0, thresholdPct - scorePct)} color="gray.3" />
            </Progress.Root>
            {result.matched_exemplar && (
              <Group gap={4}>
                <Text size="xs" fw={600}>
                  Best exemplar:
                </Text>
                <Badge size="xs" variant="outline" color="gray" ff="monospace">
                  {result.matched_exemplar}
                </Badge>
              </Group>
            )}
          </Stack>
        )}
      </div>
    </Stack>
  );
}
