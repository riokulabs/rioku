/**
 * <PermissionPathTrace> — effective-permission path viewer.
 *
 * Shows WHY a user has (or does not have) a specific permission on a tenant.
 * Reads from the mock store via usePermissionTrace() hook.
 *
 * Outcomes:
 *   - granted:   green check + role chain path + optional CEL condition tooltip
 *   - denied:    red X + which role carries the deny entry
 *   - no-source: grey dash + "No role grants this permission"
 *
 * spec §7 / Task 1d.67
 */

import { List, Text, Badge, Group, ThemeIcon, Tooltip, Stack, Box } from '@mantine/core';
import {
  IconCheck,
  IconX,
  IconMinus,
  IconUser,
  IconBuilding,
  IconShield,
  IconArrowRight,
} from '@tabler/icons-react';
import { usePermissionTrace } from '../../hooks/use-permission-trace';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PermissionPathTraceProps {
  userId: string;
  tenantId: string;
  permission: string;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OutcomeIcon({ outcome }: { outcome: 'granted' | 'denied' | 'no-source' }) {
  if (outcome === 'granted') {
    return (
      <ThemeIcon color="green" variant="light" size="sm">
        <IconCheck size={12} />
      </ThemeIcon>
    );
  }
  if (outcome === 'denied') {
    return (
      <ThemeIcon color="red" variant="light" size="sm">
        <IconX size={12} />
      </ThemeIcon>
    );
  }
  return (
    <ThemeIcon color="gray" variant="light" size="sm">
      <IconMinus size={12} />
    </ThemeIcon>
  );
}

function OutcomeLabel({ outcome }: { outcome: 'granted' | 'denied' | 'no-source' }) {
  if (outcome === 'granted') {
    return (
      <Text size="sm" c="green" fw={600}>
        Permission granted
      </Text>
    );
  }
  if (outcome === 'denied') {
    return (
      <Text size="sm" c="red" fw={600}>
        Permission denied
      </Text>
    );
  }
  return (
    <Text size="sm" c="var(--mantine-color-gray-7)" fw={600}>
      Permission not found
    </Text>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PermissionPathTrace({ userId, tenantId, permission }: PermissionPathTraceProps) {
  const trace = usePermissionTrace(userId, tenantId, permission);

  return (
    <Stack gap="sm" data-testid="permission-path-trace">
      {/* Header — outcome summary */}
      <Group gap="xs">
        <OutcomeIcon outcome={trace.outcome} />
        <OutcomeLabel outcome={trace.outcome} />
        <Badge variant="outline" size="xs" color="blue">
          {permission}
        </Badge>
      </Group>

      {/* Error message (e.g. membership not found) */}
      {trace.error && (
        <Text size="xs" c="var(--mantine-color-gray-7)">
          {trace.error}
        </Text>
      )}

      {/* Path tree */}
      {!trace.error && (
        <List spacing="xs" size="sm" center icon={<Box w={8} />}>
          {/* User node */}
          <List.Item
            icon={
              <ThemeIcon size="xs" variant="transparent" color="blue">
                <IconUser size={12} />
              </ThemeIcon>
            }
          >
            <Text size="xs" c="var(--mantine-color-gray-7)">
              User: <strong>{userId}</strong>
            </Text>
          </List.Item>

          {/* Tenant node */}
          <List.Item
            icon={
              <ThemeIcon size="xs" variant="transparent" color="grape">
                <IconBuilding size={12} />
              </ThemeIcon>
            }
          >
            <Text size="xs" c="var(--mantine-color-gray-7)">
              Tenant: <strong>{tenantId}</strong>
            </Text>
          </List.Item>

          {/* Direct roles */}
          {trace.directRoleIds.map((roleId) => (
            <List.Item
              key={roleId}
              icon={
                <ThemeIcon size="xs" variant="transparent" color="orange">
                  <IconShield size={12} />
                </ThemeIcon>
              }
            >
              <Text size="xs" c="var(--mantine-color-gray-7)">
                Role: <strong>{trace.roleNames[roleId] ?? roleId}</strong>
              </Text>
            </List.Item>
          ))}

          {/* Grant path — shown when granted */}
          {trace.outcome === 'granted' && trace.resolved && (
            <>
              {trace.resolved.path.length > 1 && (
                <List.Item
                  icon={
                    <ThemeIcon size="xs" variant="transparent" color="gray">
                      <IconArrowRight size={12} />
                    </ThemeIcon>
                  }
                >
                  <Text size="xs" c="var(--mantine-color-gray-7)">
                    Inherited via:{' '}
                    <strong>
                      {trace.resolved.path.map((id) => trace.roleNames[id] ?? id).join(' → ')}
                    </strong>
                  </Text>
                </List.Item>
              )}

              {/* CEL condition */}
              {trace.resolved.condition && (
                <List.Item
                  icon={
                    <ThemeIcon size="xs" variant="transparent" color="yellow">
                      <IconCheck size={12} />
                    </ThemeIcon>
                  }
                >
                  <Tooltip
                    label="This grant is conditional — the CEL expression must evaluate to true at request time."
                    multiline
                    maw={280}
                    position="right"
                  >
                    <Text size="xs" c="yellow.7" style={{ cursor: 'help' }}>
                      Conditional:{' '}
                      <code style={{ fontFamily: 'monospace' }}>{trace.resolved.condition}</code>
                    </Text>
                  </Tooltip>
                </List.Item>
              )}

              <List.Item
                icon={
                  <ThemeIcon size="xs" variant="transparent" color="green">
                    <IconCheck size={12} />
                  </ThemeIcon>
                }
              >
                <Text size="xs" c="green">
                  Grant found
                </Text>
              </List.Item>
            </>
          )}

          {/* Deny path — shown when denied */}
          {trace.outcome === 'denied' && trace.denyRoleId && (
            <List.Item
              icon={
                <ThemeIcon size="xs" variant="transparent" color="red">
                  <IconX size={12} />
                </ThemeIcon>
              }
            >
              <Text size="xs" c="red">
                Denied in role{' '}
                <strong>{trace.roleNames[trace.denyRoleId] ?? trace.denyRoleId}</strong> via deny
                entry
              </Text>
            </List.Item>
          )}

          {/* No source */}
          {trace.outcome === 'no-source' && !trace.error && (
            <List.Item
              icon={
                <ThemeIcon size="xs" variant="transparent" color="gray">
                  <IconMinus size={12} />
                </ThemeIcon>
              }
            >
              <Text size="xs" c="var(--mantine-color-gray-7)">
                No role grants this permission
              </Text>
            </List.Item>
          )}
        </List>
      )}
    </Stack>
  );
}
