/**
 * API keys page — /t/$tenant/security/api-keys
 *
 * Shows the list + create drawer + detail drawer.
 * Permission guard: requires api-key:read.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconKey } from '@tabler/icons-react';
import {
  ApiKeyList,
  ApiKeyCreateDrawer,
  ApiKeyDetailDrawer,
} from '@/features/security/api-keys';
import { useMockStore } from '@/api/mock-store';
import { requirePermissions } from '@/hooks/use-before-load';
import type { ApiKeyWithMeta } from '@/features/security/api-keys';

type DrawerMode = 'create' | 'detail';

function ApiKeysPage() {
  const { tenant } = Route.useParams();

  const tenantRecord = useMockStore((s) =>
    Object.values(s.tenants).find((t) => t.slug === tenant),
  );
  const tenantId = tenantRecord?.id ?? '';

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] =
    useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('create');
  const [selectedKey, setSelectedKey] = useState<ApiKeyWithMeta | null>(null);
  const [rotatedKeyValue, setRotatedKeyValue] = useState<string | null>(null);

  function handleCreate() {
    setSelectedKey(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleRowClick(key: ApiKeyWithMeta) {
    setSelectedKey(key);
    setRotatedKeyValue(null);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleRotated(fullValue: string) {
    setRotatedKeyValue(fullValue);
  }

  const drawerTitle =
    drawerMode === 'create'
      ? 'Create API key'
      : selectedKey
        ? selectedKey.name
        : 'API key';

  return (
    <Stack gap="md" p="md">
      <Group justify="space-between" align="center">
        <Group gap="xs">
          <IconKey size={20} />
          <Title order={2}>API Keys</Title>
        </Group>
        <Button leftSection={<IconPlus size={16} />} onClick={handleCreate}>
          Create key
        </Button>
      </Group>

      {rotatedKeyValue && (
        <Text size="xs" c="dimmed" ff="monospace">
          Rotated key (copy now): {rotatedKeyValue}
        </Text>
      )}

      <ApiKeyList
        tenantId={tenantId}
        onSelect={handleRowClick}
      />

      <Drawer
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="lg"
        padding="md"
      >
        {drawerMode === 'create' && (
          <ApiKeyCreateDrawer
            tenantId={tenantId}
            onSuccess={closeDrawer}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'detail' && selectedKey && (
          <ApiKeyDetailDrawer
            keyId={selectedKey.id}
            onClose={closeDrawer}
            onRotated={handleRotated}
          />
        )}
      </Drawer>
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/api-keys')({
  beforeLoad: requirePermissions({ required: ['api-key:read'] }),
  component: ApiKeysPage,
});
