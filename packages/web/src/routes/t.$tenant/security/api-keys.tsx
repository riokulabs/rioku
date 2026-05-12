/**
 * API keys page — /t/$tenant/security/api-keys
 *
 * Wired to the real daemon. Renders the list, the quick-info drawer, the
 * create form, and a `<SecretCaptureModal>`
 * that surfaces the one-time plaintext returned by `useCreateAPIKey`
 * + `useRotateAPIKey`.
 */
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Stack, Title, Group, Button, Drawer } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { IconPlus, IconKey } from '@tabler/icons-react';
import { requirePermissions } from '@/hooks/use-before-load';
import { notify } from '@/hooks/use-notify';
import {
  ApiKeyList,
  ApiKeyCreateDrawer,
  ApiKeyDrawer,
  SecretCaptureModal,
} from '@/features/security/api-keys';
import type { ApiKeyWithMeta } from '@/features/security/api-keys';

type DrawerMode = 'create' | 'detail';

function ApiKeysPage() {
  const { tenant } = Route.useParams();

  // Stage-2: tenantId is the URL slug; daemon resolves it.
  const tenantId = tenant;

  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('create');
  const [selectedKey, setSelectedKey] = useState<ApiKeyWithMeta | null>(null);
  const [capturedSecret, setCapturedSecret] = useState('');
  const [secretTitle, setSecretTitle] = useState('API key created — copy the secret');

  function handleCreate() {
    setSelectedKey(null);
    setDrawerMode('create');
    openDrawer();
  }

  function handleRowClick(key: ApiKeyWithMeta) {
    setSelectedKey(key);
    setDrawerMode('detail');
    openDrawer();
  }

  function handleCreated(fullValue: string) {
    closeDrawer();
    setSecretTitle('API key created — copy the secret');
    setCapturedSecret(fullValue);
  }

  function handleRotated(fullValue: string) {
    setSecretTitle('API key rotated — copy the new secret');
    setCapturedSecret(fullValue);
  }

  const drawerTitle =
    drawerMode === 'create' ? 'Create API key' : selectedKey ? selectedKey.name : 'API key';

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

      <ApiKeyList tenantId={tenantId} onSelect={handleRowClick} onRotated={handleRotated} />

      {/* duration=0 prevents JSDOM animation hangs in tests */}
      <Drawer
        transitionProps={{ duration: 0 }}
        opened={drawerOpened}
        onClose={closeDrawer}
        title={drawerTitle}
        position="right"
        size="min(400px, 95vw)"
        padding="md"
      >
        {drawerMode === 'create' && (
          <ApiKeyCreateDrawer
            tenantId={tenantId}
            onCreated={handleCreated}
            onCancel={closeDrawer}
          />
        )}
        {drawerMode === 'detail' && selectedKey && (
          <ApiKeyDrawer keyId={selectedKey.id} tenantId={tenantId} onClose={closeDrawer} />
        )}
      </Drawer>

      <SecretCaptureModal
        opened={capturedSecret !== ''}
        secret={capturedSecret}
        title={secretTitle}
        onConfirmCopied={() => {
          setCapturedSecret('');
          notify.success('Secret captured', 'The key value will not be shown again.');
        }}
      />
    </Stack>
  );
}

export const Route = createFileRoute('/t/$tenant/security/api-keys')({
  beforeLoad: requirePermissions({ required: ['api-key:read'] }),
  component: ApiKeysPage,
});
