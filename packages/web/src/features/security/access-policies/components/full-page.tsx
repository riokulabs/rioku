/**
 * <AccessPolicyFullPage> — full-page view of a single access policy.
 *
 * Three Mantine Tabs:
 *   - Overview: read-only metadata + CEL expression (reuses <AccessPolicyDetail>).
 *   - Test CEL: Monaco editor for the CEL expression + sample event JSON
 *               + a "Test" button that POSTs to /access-policies/test-cel.
 *               Shows match/no-match + duration. Real endpoint, no stubs.
 *   - Audit:    activity log filtered to this policy's mutations. Stage-1
 *               surface — pulled from the audit feature once it gets a
 *               resource-id filter; for now we render an informational
 *               placeholder rather than a fake list.
 */
import { useMemo, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Loader,
  Stack,
  Tabs,
  Text,
  Textarea,
  Title,
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCheck,
  IconHistory,
  IconInfoCircle,
  IconPlayerPlay,
  IconShield,
  IconX,
} from '@tabler/icons-react';
import dayjs from 'dayjs';

import { ConditionEditor } from '@/components/condition-editor';
import { useAccessPolicy, testAccessPolicyCelMutation } from '../api';
import type { TestCELResult as TestAccessPolicyCel200 } from '@/api/generated/schemas';

interface AccessPolicyFullPageProps {
  /** URL slug for the current tenant. */
  tenantSlug: string;
  /** Policy ID from the route params. */
  policyId: string;
}

// ─── Default sample shown in the Test-CEL editor ───────────────────────────────

const DEFAULT_SAMPLE_JSON = JSON.stringify(
  {
    request: {
      method: 'GET',
      path: '/api/v1/users',
      ip: '203.0.113.42',
    },
    user: {
      id: 'user-1',
      roles: ['viewer'],
    },
  },
  null,
  2,
);

// ─── Component ────────────────────────────────────────────────────────────────

export function AccessPolicyFullPage({ tenantSlug, policyId }: AccessPolicyFullPageProps) {
  const { data: policy, isLoading, error } = useAccessPolicy(tenantSlug, policyId);

  // CEL editor state. `exprDraft === null` means "not yet edited" — the
  // displayed value falls through to `policy.condition` so the editor
  // shows the persisted expression as soon as the policy resolves. Once
  // the user types anything the draft becomes a string and takes
  // precedence. This avoids the dreaded "seed from useEffect" anti-
  // pattern flagged by eslint-plugin-react-hooks/set-state-in-effect.
  const [exprDraft, setExprDraft] = useState<string | null>(null);
  const currentExpr = exprDraft ?? policy?.condition ?? '';
  const [sampleJson, setSampleJson] = useState<string>(DEFAULT_SAMPLE_JSON);
  const [testResult, setTestResult] = useState<TestAccessPolicyCel200 | null>(null);
  const [testing, setTesting] = useState(false);
  const [sampleError, setSampleError] = useState<string | null>(null);

  // Validate the sample JSON proactively so the Test button can be
  // disabled when the sample is unparsable.
  const parsedSample = useMemo<{ ok: true; value: Record<string, unknown> } | { ok: false }>(() => {
    try {
      const parsed = JSON.parse(sampleJson) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return { ok: false };
      }
      return { ok: true, value: parsed as Record<string, unknown> };
    } catch {
      return { ok: false };
    }
  }, [sampleJson]);

  async function handleTest() {
    setTestResult(null);
    setSampleError(null);
    if (!parsedSample.ok) {
      setSampleError('Sample must be a valid JSON object.');
      return;
    }
    setTesting(true);
    try {
      const result = await testAccessPolicyCelMutation(tenantSlug, {
        expr: currentExpr,
        sample: parsedSample.value,
      });
      setTestResult(result);
    } catch (err) {
      setTestResult({
        matched: false,
        durationMs: 0,
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    } finally {
      setTesting(false);
    }
  }

  if (isLoading) {
    return (
      <Group p="md">
        <Loader size="sm" />
        <Text size="sm">Loading policy…</Text>
      </Group>
    );
  }
  if (error) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />} title="Failed to load policy">
        {error.message}
      </Alert>
    );
  }
  if (!policy) {
    return (
      <Alert color="red" icon={<IconAlertCircle size={16} />}>
        Access policy not found.
      </Alert>
    );
  }

  return (
    <Stack gap="md" p="md">
      <Stack gap={4}>
        <Title order={2}>{policy.name}</Title>
        <Group gap="xs">
          <Badge color={policy.action === 'allow' ? 'green' : 'red'} variant="light">
            {policy.action}
          </Badge>
          <Badge color={policy.enabled ? 'teal' : 'gray'} variant="outline">
            {policy.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <Badge variant="outline" color="blue">
            Priority {policy.priority}
          </Badge>
          {policy.created_at && (
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Created {dayjs(policy.created_at).format('MMM D, YYYY HH:mm')}
            </Text>
          )}
        </Group>
      </Stack>

      <Divider />

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconShield size={14} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="test-cel" leftSection={<IconPlayerPlay size={14} />}>
            Test CEL
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Stack gap="xs">
            <Text size="sm" fw={600}>
              CEL expression
            </Text>
            <ConditionEditor
              value={policy.condition}
              onChange={() => undefined}
              readOnly
              height={160}
            />
            <Text size="xs" c="dimmed">
              ID: <Code>{policy.id}</Code>
            </Text>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="test-cel" pt="md">
          <Stack gap="md">
            <Stack gap="xs">
              <Text size="sm" fw={600}>
                CEL expression
              </Text>
              <ConditionEditor
                value={currentExpr}
                onChange={(v) => {
                  setExprDraft(v);
                }}
                placeholder={'request.method == "GET"'}
                height={140}
              />
            </Stack>

            <Stack gap="xs">
              <Text size="sm" fw={600}>
                Sample event (JSON)
              </Text>
              <Textarea
                value={sampleJson}
                onChange={(e) => {
                  setSampleJson(e.currentTarget.value);
                }}
                autosize
                minRows={6}
                maxRows={20}
                styles={{ input: { fontFamily: 'monospace', fontSize: 13 } }}
                aria-label="Sample event JSON"
              />
              {!parsedSample.ok && (
                <Text size="xs" c="red">
                  Sample must be a valid JSON object.
                </Text>
              )}
            </Stack>

            <Group>
              <Button
                onClick={() => void handleTest()}
                loading={testing}
                leftSection={<IconPlayerPlay size={14} />}
                disabled={!parsedSample.ok || currentExpr.trim() === ''}
              >
                Test
              </Button>
              {sampleError && <Text size="sm" c="red">{sampleError}</Text>}
            </Group>

            {testResult && (
              <Alert
                color={testResult.error ? 'red' : testResult.matched ? 'green' : 'gray'}
                icon={
                  testResult.error
                    ? <IconAlertCircle size={16} />
                    : testResult.matched
                      ? <IconCheck size={16} />
                      : <IconX size={16} />
                }
                title={
                  testResult.error
                    ? 'Evaluation error'
                    : testResult.matched
                      ? 'Matched'
                      : 'Did not match'
                }
              >
                <Stack gap={4}>
                  {testResult.error ? (
                    <Code block>{testResult.error}</Code>
                  ) : (
                    <Text size="sm">
                      Expression evaluated to {testResult.matched ? <strong>true</strong> : <strong>false</strong>}.
                    </Text>
                  )}
                  <Text size="xs" c="dimmed">
                    Duration: {(testResult.durationMs ?? 0).toFixed(2)} ms
                  </Text>
                </Stack>
              </Alert>
            )}
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <Alert color="blue" variant="light" icon={<IconInfoCircle size={16} />}>
            <Text size="sm">
              The audit feed for this policy is sourced from the global audit
              log filtered by{' '}
              <Code>resource_id = {policy.id}</Code>. Visit the{' '}
              <strong>Security → Audit</strong> page and apply the filter to
              see mutations recorded against this policy.
            </Text>
          </Alert>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
