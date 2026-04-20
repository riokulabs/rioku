/**
 * <ProfilePersonalInfo> — name inline-edit, email (read-only), avatar uploader.
 *
 * Name: TextInput that shows a "Save" button only when dirty. Autosaves on
 * button click (not on blur — provides explicit save UX).
 *
 * Avatar: Dropzone accepting images; previews the chosen file. "Remove" clears.
 *
 * Task 8a.2
 */
import { useState, useCallback, useEffect } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Group,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useForm, schemaResolver } from '@mantine/form';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { IconAlertCircle, IconUpload, IconX, IconPhoto } from '@tabler/icons-react';
import { notify } from '@/hooks/use-notify';
import { usePermission } from '@/hooks/use-permission';
import { updateProfileName, updateProfileAvatar } from '../api';
import { profileNameSchema } from '../schemas';
import type { User } from '@/api/resources/types';

interface ProfilePersonalInfoProps {
  user: User;
}

export function ProfilePersonalInfo({ user }: ProfilePersonalInfoProps) {
  const canUpdate = usePermission('user:update-own');

  // ── Name form ─────────────────────────────────────────────────────────────
  const [nameLoading, setNameLoading] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const nameForm = useForm({
    initialValues: { name: user.name },
    validate: schemaResolver(profileNameSchema, { sync: true }),
  });

  const handleNameSubmit = useCallback(
    async (values: { name: string }) => {
      setNameLoading(true);
      setNameError(null);
      try {
        await updateProfileName(user.id, values.name);
        notify.success('Name updated', `Display name changed to "${values.name}".`);
        nameForm.resetDirty(values);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to update name';
        setNameError(msg);
      } finally {
        setNameLoading(false);
      }
    },
    [user.id, nameForm],
  );

  // ── Avatar ────────────────────────────────────────────────────────────────
  const [avatarPreview, setAvatarPreview] = useState<string | null>(
    user.avatar_url ?? null,
  );
  const [avatarLoading, setAvatarLoading] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  // Revoke object URLs when avatarPreview changes or on unmount to prevent leaks.
  useEffect(
    () => () => {
      if (avatarPreview?.startsWith('blob:')) URL.revokeObjectURL(avatarPreview);
    },
    [avatarPreview],
  );

  const handleAvatarDrop = useCallback(
    async (files: File[]) => {
      const file = files[0];
      if (!file) return;
      setAvatarLoading(true);
      setAvatarError(null);
      try {
        // In mock mode, create an object URL as a stand-in for an uploaded URL.
        const url = URL.createObjectURL(file);
        setAvatarPreview(url);
        await updateProfileAvatar(user.id, url);
        notify.success('Avatar updated');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to upload avatar';
        setAvatarError(msg);
      } finally {
        setAvatarLoading(false);
      }
    },
    [user.id],
  );

  const handleRemoveAvatar = useCallback(async () => {
    setAvatarLoading(true);
    setAvatarError(null);
    try {
      setAvatarPreview(null);
      await updateProfileAvatar(user.id, null);
      notify.success('Avatar removed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to remove avatar';
      setAvatarError(msg);
    } finally {
      setAvatarLoading(false);
    }
  }, [user.id]);

  return (
    <Stack gap="md" data-testid="profile-personal-info">
      {/* Avatar */}
      <Group align="flex-start" gap="md">
        <Avatar
          src={avatarPreview ?? null}
          size={72}
          radius="md"
          data-testid="profile-avatar-preview"
        >
          {user.name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()}
        </Avatar>
        <Stack gap="xs" flex={1}>
          {avatarError && (
            <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" py="xs">
              {avatarError}
            </Alert>
          )}
          <Tooltip
            label="You don't have permission to update your profile"
            disabled={canUpdate}
            withArrow
          >
            <div>
              <Dropzone
                onDrop={(files) => { void handleAvatarDrop(files); }}
                onReject={(files) => {
                  const reason = files[0]?.errors[0]?.code;
                  const msg =
                    reason === 'file-too-large'
                      ? 'Image must be 3 MB or smaller.'
                      : 'Only image files are accepted.';
                  setAvatarError(msg);
                }}
                accept={IMAGE_MIME_TYPE}
                maxSize={3 * 1024 ** 2}
                maxFiles={1}
                disabled={!canUpdate || avatarLoading}
                data-testid="profile-avatar-dropzone"
              >
                <Group gap="xs" style={{ pointerEvents: 'none' }}>
                  <Dropzone.Accept>
                    <IconUpload size={16} />
                  </Dropzone.Accept>
                  <Dropzone.Reject>
                    <IconX size={16} />
                  </Dropzone.Reject>
                  <Dropzone.Idle>
                    <IconPhoto size={16} />
                  </Dropzone.Idle>
                  <Text size="sm">
                    Drop an image here or click to upload (max 3 MB)
                  </Text>
                </Group>
              </Dropzone>
            </div>
          </Tooltip>
          {avatarPreview !== null && (
            <Button
              variant="subtle"
              color="red"
              size="xs"
              onClick={() => { void handleRemoveAvatar(); }}
              loading={avatarLoading}
              disabled={!canUpdate}
              data-testid="profile-avatar-remove"
            >
              Remove avatar
            </Button>
          )}
        </Stack>
      </Group>

      {/* Name */}
      <form
        onSubmit={nameForm.onSubmit((v) => {
          void handleNameSubmit(v);
        })}
        data-testid="profile-name-form"
      >
        <Stack gap="xs">
          {nameError && (
            <Alert icon={<IconAlertCircle size={14} />} color="red" variant="light" py="xs">
              {nameError}
            </Alert>
          )}
          <Group align="flex-end" gap="sm">
            <TextInput
              label="Display name"
              style={{ flex: 1 }}
              disabled={!canUpdate}
              data-testid="profile-name-input"
              {...nameForm.getInputProps('name')}
            />
            {nameForm.isDirty() && (
              <Tooltip
                label="You don't have permission to update your profile"
                disabled={canUpdate}
                withArrow
              >
                <span>
                  <Button
                    type="submit"
                    loading={nameLoading}
                    disabled={!canUpdate}
                    size="sm"
                    data-testid="profile-name-save"
                  >
                    Save
                  </Button>
                </span>
              </Tooltip>
            )}
          </Group>
        </Stack>
      </form>

      {/* Email (read-only) */}
      <TextInput
        label="Email"
        value={user.email}
        readOnly
        description="Email cannot be changed from this panel."
        data-testid="profile-email-input"
      />
    </Stack>
  );
}
