/**
 * <RbacPolicyFullPage> — dedicated full-screen RBAC policy view.
 *
 * Tabs:
 *   1. Overview        — name, description, subject + role binding, status.
 *   2. Bound subjects  — every other policy that targets the same role
 *                        (i.e. the full set of subjects bound to that role
 *                        through RBAC policy bindings).
 *   3. Audit           — recent audit entries for this policy resource.
 *
 * Reads exclusively via the real-API hooks — no mock store.
 */
import { Stack, Group, Title, Text, Badge, Tabs, Paper, Table, Loader } from '@mantine/core';
import { IconLock, IconUsers, IconHistory } from '@tabler/icons-react';
import { useListAuditActors } from '@/api/generated/audit/audit';
import { useRbacPolicy, useBoundSubjects } from '../api';
import type { RbacSubjectType } from '../types';

interface RbacPolicyFullPageProps {
  tenant: string;
  policyId: string;
}

const SUBJECT_LABELS: Record<RbacSubjectType, string> = {
  user: 'User',
  group: 'Group',
  'service-account': 'Service account',
};

export function RbacPolicyFullPage({ tenant, policyId }: RbacPolicyFullPageProps) {
  const policy = useRbacPolicy(tenant, policyId);
  const boundSubjects = useBoundSubjects(tenant, policy?.role_id ?? '');

  // The audit-actors endpoint is the smallest stable surface available
  // for resource-level audit summaries; switching to the full audit
  // entries stream is tracked under plan-05 (audit extended).
  const auditQuery = useListAuditActors(tenant, undefined, {
    query: { enabled: tenant.length > 0 },
  });
  const auditCount = (auditQuery.data?.data as { actors?: unknown[] } | undefined)?.actors?.length ?? 0;

  if (!policy) {
    return (
      <Stack p="md" gap="xs" align="flex-start" data-testid="rbac-policy-full-page-loading">
        <Loader size="sm" />
        <Text size="sm" c="dimmed">
          Loading policy…
        </Text>
      </Stack>
    );
  }

  return (
    <Stack gap="md" p="md" data-testid="rbac-policy-full-page">
      <Group justify="space-between" align="flex-start">
        <Stack gap={4}>
          <Group gap="xs" align="center">
            <IconLock size={20} />
            <Title order={2}>{policy.name}</Title>
          </Group>
          <Group gap="xs">
            <Badge color="violet" variant="light" size="sm">
              {SUBJECT_LABELS[policy.subject_type]}
            </Badge>
            {policy.enabled ? (
              <Badge color="green" variant="light" size="sm">
                Enabled
              </Badge>
            ) : (
              <Badge color="gray" variant="light" size="sm">
                Disabled
              </Badge>
            )}
          </Group>
        </Stack>
      </Group>

      <Tabs defaultValue="overview">
        <Tabs.List>
          <Tabs.Tab value="overview">Overview</Tabs.Tab>
          <Tabs.Tab
            value="bound-subjects"
            leftSection={<IconUsers size={14} />}
            data-testid="tab-bound-subjects"
          >
            Bound subjects ({boundSubjects.length})
          </Tabs.Tab>
          <Tabs.Tab
            value="audit"
            leftSection={<IconHistory size={14} />}
            data-testid="tab-audit"
          >
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <Paper withBorder p="md" radius="sm">
            <Stack gap="sm">
              {policy.description && <Text size="sm">{policy.description}</Text>}
              <Stack gap={2}>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  Subject
                </Text>
                <Text size="sm" ff="monospace">
                  {policy.subject_id || '—'}
                </Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  Bound role
                </Text>
                <Text size="sm" ff="monospace">
                  {policy.role_id || '—'}
                </Text>
              </Stack>
              <Stack gap={2}>
                <Text size="xs" c="var(--mantine-color-gray-7)">
                  Policy ID
                </Text>
                <Text size="sm" ff="monospace">
                  {policy.id}
                </Text>
              </Stack>
            </Stack>
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="bound-subjects" pt="md">
          <Paper withBorder p="md" radius="sm">
            {boundSubjects.length === 0 ? (
              <Stack align="center" gap="xs" py="md">
                <IconUsers size={28} stroke={1.4} />
                <Text size="sm" c="dimmed">
                  No subjects bound to this role.
                </Text>
              </Stack>
            ) : (
              <Table data-testid="bound-subjects-table">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Policy</Table.Th>
                    <Table.Th>Subject type</Table.Th>
                    <Table.Th>Subject ID</Table.Th>
                    <Table.Th>Status</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {boundSubjects.map((p) => (
                    <Table.Tr key={p.id}>
                      <Table.Td>{p.name}</Table.Td>
                      <Table.Td>
                        <Badge variant="light" size="sm">
                          {SUBJECT_LABELS[p.subject_type]}
                        </Badge>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" ff="monospace">
                          {p.subject_id}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {p.enabled ? (
                          <Badge color="green" variant="light" size="sm">
                            Enabled
                          </Badge>
                        ) : (
                          <Badge color="gray" variant="light" size="sm">
                            Disabled
                          </Badge>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
          </Paper>
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <Paper withBorder p="md" radius="sm" data-testid="audit-panel">
            <Stack gap="xs">
              <Text size="sm" c="var(--mantine-color-gray-7)">
                Recent audit activity for this tenant. Resource-scoped filtering
                lands with the plan-05 audit extension.
              </Text>
              {auditQuery.isLoading ? (
                <Group gap="xs">
                  <Loader size="xs" />
                  <Text size="sm" c="dimmed">
                    Loading audit data…
                  </Text>
                </Group>
              ) : (
                <Text size="sm" data-testid="audit-summary">
                  {auditCount} actor{auditCount === 1 ? '' : 's'} have produced audit entries in
                  this tenant.
                </Text>
              )}
            </Stack>
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}
