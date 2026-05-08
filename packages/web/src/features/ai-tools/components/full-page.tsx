/**
 * <ToolFullPage> — full-page tabbed view for a single AI tool.
 *
 * Tabs:
 *   - Definition       (read/edit identity + schema + delete)
 *   - Test invocation  (Monaco JSON editor + Invoke button + result)
 *   - Audit            (recent audit entries for this tool)
 */
import { useState } from 'react';
import { Alert, Drawer, Stack, Tabs } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconAlertCircle, IconCode, IconHistory, IconPlayerPlay } from '@tabler/icons-react';
import { useToolDetail } from '../api';
import { ToolDetail } from './detail';
import { ToolForm } from './form';
import { TestInvocation } from './test-invocation';
import { ToolAuditTab } from './audit-tab';

interface ToolFullPageProps {
  tenant: string;
  toolId: string;
  /** Called when the tool is deleted. */
  onDeleted: () => void;
  /** Default active tab — controlled via the route's `tab` search param. */
  initialTab?: 'definition' | 'invoke' | 'audit';
  onTabChange?: (tab: 'definition' | 'invoke' | 'audit') => void;
}

export function ToolFullPage({
  tenant,
  toolId,
  onDeleted,
  initialTab = 'definition',
  onTabChange,
}: ToolFullPageProps) {
  const tool = useToolDetail(tenant, toolId);
  const [tab, setTab] = useState<'definition' | 'invoke' | 'audit'>(initialTab);
  const [editOpened, { open: openEdit, close: closeEdit }] = useDisclosure(false);

  if (!tool) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Tool not found.
      </Alert>
    );
  }

  function handleTabChange(value: string | null) {
    if (value !== 'definition' && value !== 'invoke' && value !== 'audit') return;
    setTab(value);
    onTabChange?.(value);
  }

  return (
    <Stack gap="md">
      <Tabs value={tab} onChange={handleTabChange} keepMounted={false}>
        <Tabs.List>
          <Tabs.Tab value="definition" leftSection={<IconCode size={14} />}>
            Definition
          </Tabs.Tab>
          <Tabs.Tab value="invoke" leftSection={<IconPlayerPlay size={14} />}>
            Test invocation
          </Tabs.Tab>
          <Tabs.Tab value="audit" leftSection={<IconHistory size={14} />}>
            Audit
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="definition" pt="md">
          <ToolDetail tenant={tenant} toolId={toolId} onEdit={openEdit} onClose={onDeleted} />
        </Tabs.Panel>

        <Tabs.Panel value="invoke" pt="md">
          <TestInvocation tenant={tenant} toolId={toolId} />
        </Tabs.Panel>

        <Tabs.Panel value="audit" pt="md">
          <ToolAuditTab tenant={tenant} toolId={toolId} />
        </Tabs.Panel>
      </Tabs>

      <Drawer
        transitionProps={{ duration: 0 }}
        opened={editOpened}
        onClose={closeEdit}
        title={`Edit — ${tool.name}`}
        position="right"
        size="min(560px, 95vw)"
        padding="md"
      >
        <ToolForm
          mode="edit"
          tenant={tenant}
          initialValues={tool}
          onSuccess={() => {
            closeEdit();
          }}
          onCancel={closeEdit}
        />
      </Drawer>
    </Stack>
  );
}
