/**
 * <ModelManager> — manage the models published by a provider.
 *
 * Shows a Mantine Table of models with upstream_id, alias, rate_limit_rpm,
 * daily_quota_tokens, enabled Switch, and per-row actions. An "Add model"
 * button opens a Collapse form below the table.
 */
import { useState } from 'react';
import {
  ActionIcon,
  Alert,
  Button,
  Collapse,
  Group,
  NumberInput,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useForm, schemaResolver } from '@mantine/form';
import { IconAlertCircle, IconPlus, IconTrash } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { useAddModel, useRemoveModel, useUpdateModel, useProviderDetail } from '../api';
import { addModelSchema } from '../schemas';

interface ModelManagerProps {
  tenant: string;
  providerId: string;
}

interface AddModelFormValues {
  upstream_id: string;
  alias: string;
  rate_limit_rpm: number | null;
  daily_quota_tokens: number | null;
  enabled: boolean;
}

const EMPTY_FORM: AddModelFormValues = {
  upstream_id: '',
  alias: '',
  rate_limit_rpm: null,
  daily_quota_tokens: null,
  enabled: true,
};

export function ModelManager({ tenant, providerId }: ModelManagerProps) {
  const provider = useProviderDetail(tenant, providerId);
  const addModelMut = useAddModel(tenant);
  const updateModelMut = useUpdateModel(tenant);
  const removeModelMut = useRemoveModel(tenant);
  const [formOpened, { toggle: toggleForm, close: closeForm }] = useDisclosure(false);
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<AddModelFormValues>({
    initialValues: EMPTY_FORM,
    validate: schemaResolver(addModelSchema, { sync: true }),
  });

  if (!provider) {
    return (
      <Alert color="red" variant="light" icon={<IconAlertCircle size={16} />}>
        Provider not found.
      </Alert>
    );
  }

  async function handleAddModel(values: AddModelFormValues) {
    setFormError(null);
    try {
      await addModelMut.mutateAsync({
        providerId,
        model: {
          upstream_id: values.upstream_id.trim(),
          alias: values.alias.trim(),
          rate_limit_rpm: values.rate_limit_rpm,
          daily_quota_tokens: values.daily_quota_tokens,
          enabled: values.enabled,
        },
      });
      notify.success('Model added', `${values.alias} is available.`);
      form.setValues(EMPTY_FORM);
      form.reset();
      closeForm();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to add model';
      setFormError(msg);
    }
  }

  async function handleToggle(upstreamId: string, enabled: boolean) {
    try {
      await updateModelMut.mutateAsync({ providerId, upstreamId, patch: { enabled } });
    } catch {
      notify.error('Failed to update model', 'Please try again.');
    }
  }

  async function handleRemove(upstreamId: string, alias: string) {
    try {
      await removeModelMut.mutateAsync({ providerId, upstreamId });
      notify.success('Model removed', `${alias} was removed.`);
    } catch {
      notify.error('Failed to remove model', 'Please try again.');
    }
  }

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Text size="sm" fw={600}>
          Models ({String(provider.models.length)})
        </Text>
        <Button size="xs" variant="light" leftSection={<IconPlus size={14} />} onClick={toggleForm}>
          Add model
        </Button>
      </Group>

      {provider.models.length === 0 ? (
        <Text size="xs" c="var(--mantine-color-gray-7)">
          No models published yet. Add an upstream model to expose it to agents.
        </Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Upstream ID</Table.Th>
              <Table.Th>Alias</Table.Th>
              <Table.Th>RPM</Table.Th>
              <Table.Th>Daily tokens</Table.Th>
              <Table.Th>Enabled</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {provider.models.map((m) => (
              <Table.Tr key={m.upstream_id}>
                <Table.Td>
                  <Text size="xs" ff="monospace">
                    {m.upstream_id}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" ff="monospace">
                    {m.alias}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {m.rate_limit_rpm === null ? '—' : String(m.rate_limit_rpm)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Text size="xs">
                    {m.daily_quota_tokens === null ? '—' : String(m.daily_quota_tokens)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <Switch
                    checked={m.enabled}
                    aria-label={`Toggle ${m.alias}`}
                    onChange={(e) => {
                      void handleToggle(m.upstream_id, e.currentTarget.checked);
                    }}
                  />
                </Table.Td>
                <Table.Td>
                  <ActionIcon
                    variant="subtle"
                    color="red.8"
                    aria-label={`Remove ${m.alias}`}
                    onClick={() => {
                      void handleRemove(m.upstream_id, m.alias);
                    }}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}

      <Collapse expanded={formOpened}>
        <form
          onSubmit={form.onSubmit((v) => {
            void handleAddModel(v);
          })}
        >
          <Stack gap="sm" p="sm" bg="var(--mantine-color-gray-0)">
            {formError && (
              <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light">
                {formError}
              </Alert>
            )}
            <Group grow>
              <TextInput
                label="Upstream ID"
                placeholder="gpt-4o"
                required
                {...form.getInputProps('upstream_id')}
              />
              <TextInput
                label="Alias"
                placeholder="gpt-4o"
                required
                {...form.getInputProps('alias')}
              />
            </Group>
            <Group grow>
              <NumberInput
                label="Rate limit (RPM)"
                placeholder="Leave empty for no limit"
                min={1}
                value={form.values.rate_limit_rpm ?? ''}
                onChange={(v) => {
                  form.setFieldValue('rate_limit_rpm', typeof v === 'number' ? v : null);
                }}
              />
              <NumberInput
                label="Daily token quota"
                placeholder="Leave empty for no quota"
                min={1}
                value={form.values.daily_quota_tokens ?? ''}
                onChange={(v) => {
                  form.setFieldValue('daily_quota_tokens', typeof v === 'number' ? v : null);
                }}
              />
            </Group>
            <Switch
              label="Enabled"
              checked={form.values.enabled}
              onChange={(e) => {
                form.setFieldValue('enabled', e.currentTarget.checked);
              }}
            />
            <Group justify="flex-end">
              <Button
                variant="default"
                size="xs"
                type="button"
                onClick={() => {
                  closeForm();
                  form.setValues(EMPTY_FORM);
                  form.reset();
                }}
              >
                Cancel
              </Button>
              <Button size="xs" type="submit" loading={addModelMut.isPending}>
                Add model
              </Button>
            </Group>
          </Stack>
        </form>
      </Collapse>
    </Stack>
  );
}
