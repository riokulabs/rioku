/**
 * Tests for <ProfileSection> and subcomponents.
 *
 * Covers:
 *   - All 5 subsections render
 *   - Name inline-edit submits through store and emits audit + host event
 *   - Password modal: validation (mismatch, too-short), submit success
 *   - TOTP backup-code reset triggers regeneration
 *   - Preferences changes persist to store
 *   - user:update-own permission missing → save buttons disabled
 *
 * Task 8a.2
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';

// ─── Router stub ─────────────────────────────────────────────────────────────

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => () => undefined,
  useRouter: () => ({ navigate: () => undefined }),
  Link: ({
    children,
    to: _to,
    params: _params,
    ...rest
  }: React.PropsWithChildren<{ to: string; params?: Record<string, string> }> &
    Record<string, unknown>) => <a {...rest}>{children}</a>,
}));

// ─── Theme stub ───────────────────────────────────────────────────────────────

vi.mock('@/hooks/use-active-theme', () => ({
  useActiveTheme: () => ['dark', vi.fn()] as [string, (v: string) => void],
}));

// ─── Permission mock ─────────────────────────────────────────────────────────

let grantUpdate = true;
vi.mock('@/hooks/use-permission', () => ({
  usePermission: (key: string) => (key === 'user:update-own' ? grantUpdate : true),
}));

// ─── Feature flags mock ───────────────────────────────────────────────────────
// Passkeys flag is off in tests — the section should be hidden until stage-2 wires it.
vi.mock('@/host/feature-flags', () => ({
  isFeatureEnabled: (flag: string) => flag !== 'passkeys',
}));

// ─── Dropzone stub ───────────────────────────────────────────────────────────
// @mantine/dropzone uses ResizeObserver + File API internals that aren't
// available in jsdom. Stub all the named exports used by profile-personal-info.
function DropzoneStub({
  children,
  onDrop: _onDrop,
  ...rest
}: React.PropsWithChildren<Record<string, unknown>>) {
  return (
    <div data-testid="profile-avatar-dropzone" {...rest}>
      {children}
    </div>
  );
}
function Noop({ children }: React.PropsWithChildren) {
  return <>{children}</>;
}
DropzoneStub.Accept = Noop;
DropzoneStub.Reject = Noop;
DropzoneStub.Idle = Noop;

vi.mock('@mantine/dropzone', () => ({
  Dropzone: DropzoneStub,
  IMAGE_MIME_TYPE: ['image/png', 'image/jpeg'],
}));

// ─── Imports ─────────────────────────────────────────────────────────────────

import { useMockStore } from '@/api/mock-store';
import { mockBus } from '@/api/mock-sse';
import { seedStore } from '@/api/mock-seed';
import { ProfileSection } from '../sections/profile';
import { ProfilePasswordModal } from '../sections/profile-password-modal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function getDerrickId(): string {
  const state = useMockStore.getState();
  const user = Object.values(state.users).find((u) => u.email === 'derrick@rioku.dev');
  if (!user) throw new Error('Derrick user not found in seed data');
  return user.id;
}

beforeEach(() => {
  useMockStore.getState().reset();
  seedStore(useMockStore);
  grantUpdate = true;

  // Set current user to Derrick so useCurrentUser() returns him.
  const derrickId = getDerrickId();
  useMockStore.setState({ currentUserId: derrickId });
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('<ProfileSection> — undefined user guard', () => {
  it('renders a loading state instead of crashing when currentUserId is null', () => {
    // Force the store to have no logged-in user. This simulates a race condition
    // (or a future bug) where ProfileSection mounts before the session is set.
    // Without the `if (!user) { return <Loader/> }` guard, this would throw
    // "Cannot read properties of undefined (reading 'email')" inside
    // ProfilePersonalInfo at user.email.
    useMockStore.setState({ currentUserId: null });

    render(<ProfileSection />, { wrapper: Wrapper });

    // Must render the loading fallback, not crash.
    expect(screen.getByTestId('profile-loading')).toBeDefined();

    // The full section must NOT be in the DOM.
    expect(screen.queryByTestId('profile-section')).toBeNull();
    expect(screen.queryByTestId('profile-email-input')).toBeNull();
  });
});

describe('<ProfileSection>', () => {
  it('renders 4 subsections (Passkeys hidden by feature flag)', () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    expect(screen.getByTestId('profile-personal-info')).toBeDefined();
    expect(screen.getByTestId('profile-password-section')).toBeDefined();
    expect(screen.getByTestId('profile-totp-section')).toBeDefined();
    // Passkeys section is hidden when the `passkeys` feature flag is off
    expect(screen.queryByTestId('profile-passkeys-section')).toBeNull();
    expect(screen.getByTestId('profile-preferences-section')).toBeDefined();
  });

  it('renders the user email as read-only', () => {
    render(<ProfileSection />, { wrapper: Wrapper });
    const emailInput = screen.getByTestId<HTMLInputElement>('profile-email-input');
    expect(emailInput.value).toBe('derrick@rioku.dev');
    expect(emailInput.readOnly).toBe(true);
  });

  it('renders TOTP enrolled badge for Derrick (seeded as enrolled)', () => {
    render(<ProfileSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('profile-totp-status-enrolled')).toBeDefined();
  });

  it('renders backup codes reset button when TOTP enrolled', () => {
    render(<ProfileSection />, { wrapper: Wrapper });
    expect(screen.getByTestId('profile-backup-codes-reset')).toBeDefined();
  });

  it('does not render Passkeys "Coming soon" text when feature flag is off', () => {
    render(<ProfileSection />, { wrapper: Wrapper });
    expect(screen.queryByText(/coming soon/i)).toBeNull();
  });

  // ── Name inline-edit ─────────────────────────────────────────────────────

  it('name save button appears only when name input is dirty', async () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    // Save button should not be visible initially (name not dirty).
    expect(screen.queryByTestId('profile-name-save')).toBeNull();

    // Modify the name input.
    const nameInput = screen.getByTestId<HTMLInputElement>('profile-name-input');
    fireEvent.change(nameInput, { target: { value: 'Derrick Updated' } });

    await waitFor(() => {
      expect(screen.getByTestId('profile-name-save')).toBeDefined();
    });
  });

  it('name save submits through store', async () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    const nameInput = screen.getByTestId<HTMLInputElement>('profile-name-input');
    fireEvent.change(nameInput, { target: { value: 'Derrick Updated' } });

    await waitFor(() => screen.getByTestId('profile-name-save'));
    fireEvent.click(screen.getByTestId('profile-name-save'));

    await waitFor(() => {
      const derrickId = getDerrickId();
      const user = useMockStore.getState().users[derrickId];
      expect(user?.name).toBe('Derrick Updated');
    });
  });

  it('name save emits an audit entry', async () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    const nameInput = screen.getByTestId<HTMLInputElement>('profile-name-input');
    fireEvent.change(nameInput, { target: { value: 'AuditCheck' } });

    await waitFor(() => screen.getByTestId('profile-name-save'));
    fireEvent.click(screen.getByTestId('profile-name-save'));

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'user.profile.update_name');
      expect(entry).toBeDefined();
    });
  });

  // ── Backup codes reset ────────────────────────────────────────────────────

  it('backup codes reset regenerates codes in store', async () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    const resetBtn = screen.getByTestId('profile-backup-codes-reset');
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const derrickId = getDerrickId();
      const user = useMockStore.getState().users[derrickId];
      expect(user?.backup_codes).toBeDefined();
      expect((user?.backup_codes ?? []).length).toBe(10);
    });
  });

  it('backup codes reset emits an audit entry', async () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    const resetBtn = screen.getByTestId('profile-backup-codes-reset');
    fireEvent.click(resetBtn);

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'user.profile.reset_backup_codes');
      expect(entry).toBeDefined();
    });
  });

  // ── Permission guard ──────────────────────────────────────────────────────

  it('name save button is disabled without user:update-own', () => {
    grantUpdate = false;
    render(<ProfileSection />, { wrapper: Wrapper });

    const nameInput = screen.getByTestId<HTMLInputElement>('profile-name-input');
    // Input itself is disabled.
    expect(nameInput.disabled).toBe(true);
  });

  it('change password button is disabled without user:update-own', () => {
    grantUpdate = false;
    render(<ProfileSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId<HTMLButtonElement>('profile-change-password-btn');
    expect(btn.disabled).toBe(true);
  });

  it('backup codes reset button is disabled without user:update-own', () => {
    grantUpdate = false;
    render(<ProfileSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId<HTMLButtonElement>('profile-backup-codes-reset');
    expect(btn.disabled).toBe(true);
  });
});

// ─── Password modal tests ─────────────────────────────────────────────────────

describe('<ProfilePasswordModal>', () => {
  it('renders password form fields', () => {
    const derrickId = getDerrickId();
    render(<ProfilePasswordModal userId={derrickId} opened onClose={() => undefined} />, {
      wrapper: Wrapper,
    });

    expect(screen.getByTestId('password-current')).toBeDefined();
    expect(screen.getByTestId('password-new')).toBeDefined();
    expect(screen.getByTestId('password-confirm')).toBeDefined();
    expect(screen.getByTestId('password-submit')).toBeDefined();
  });

  it('validates that passwords match', async () => {
    const derrickId = getDerrickId();
    render(<ProfilePasswordModal userId={derrickId} opened onClose={() => undefined} />, {
      wrapper: Wrapper,
    });

    // Fill mismatched passwords.
    fireEvent.change(screen.getByTestId('password-current'), {
      target: { value: 'OldPass1' },
    });
    fireEvent.change(screen.getByTestId('password-new'), {
      target: { value: 'NewPass123' },
    });
    fireEvent.change(screen.getByTestId('password-confirm'), {
      target: { value: 'DifferentPass' },
    });

    fireEvent.click(screen.getByTestId('password-submit'));

    await waitFor(() => {
      expect(screen.getByText(/passwords do not match/i)).toBeDefined();
    });
  });

  it('validates minimum password length', async () => {
    const derrickId = getDerrickId();
    render(<ProfilePasswordModal userId={derrickId} opened onClose={() => undefined} />, {
      wrapper: Wrapper,
    });

    fireEvent.change(screen.getByTestId('password-current'), {
      target: { value: 'OldPass1' },
    });
    fireEvent.change(screen.getByTestId('password-new'), {
      target: { value: 'short' },
    });
    fireEvent.change(screen.getByTestId('password-confirm'), {
      target: { value: 'short' },
    });

    fireEvent.click(screen.getByTestId('password-submit'));

    await waitFor(() => {
      expect(screen.getByText(/at least 8 characters/i)).toBeDefined();
    });
  });

  it('successful submit emits audit entry', async () => {
    const derrickId = getDerrickId();
    const onClose = vi.fn();
    render(<ProfilePasswordModal userId={derrickId} opened onClose={onClose} />, {
      wrapper: Wrapper,
    });

    fireEvent.change(screen.getByTestId('password-current'), {
      target: { value: 'OldPass1' },
    });
    fireEvent.change(screen.getByTestId('password-new'), {
      target: { value: 'NewPass123' },
    });
    fireEvent.change(screen.getByTestId('password-confirm'), {
      target: { value: 'NewPass123' },
    });

    fireEvent.click(screen.getByTestId('password-submit'));

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'user.profile.change_password');
      expect(entry).toBeDefined();
    });
  });

  it('submit button is disabled without user:update-own', () => {
    grantUpdate = false;
    const derrickId = getDerrickId();
    render(<ProfilePasswordModal userId={derrickId} opened onClose={() => undefined} />, {
      wrapper: Wrapper,
    });
    const btn = screen.getByTestId<HTMLButtonElement>('password-submit');
    expect(btn.disabled).toBe(true);
  });
});

// ─── Preferences tests ────────────────────────────────────────────────────────

describe('<ProfileSection> — preferences', () => {
  it('renders theme, locale, timezone, motion and notification controls', () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    expect(screen.getByTestId('profile-theme-select')).toBeDefined();
    expect(screen.getByTestId('profile-locale-select')).toBeDefined();
    expect(screen.getByTestId('profile-timezone-select')).toBeDefined();
    expect(screen.getByTestId('profile-reduced-motion')).toBeDefined();
    expect(screen.getByTestId('profile-notification-email')).toBeDefined();
    expect(screen.getByTestId('profile-notification-in-app')).toBeDefined();
    expect(screen.getByTestId('profile-preferences-save')).toBeDefined();
  });

  it('preferences save persists to store', async () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    // Toggle the reduced-motion switch.
    const motionSwitch = screen.getByTestId<HTMLInputElement>('profile-reduced-motion');
    const initialValue = motionSwitch.checked;
    fireEvent.click(motionSwitch);

    fireEvent.click(screen.getByTestId('profile-preferences-save'));

    await waitFor(() => {
      const derrickId = getDerrickId();
      const user = useMockStore.getState().users[derrickId];
      // reduced_motion should have flipped.
      expect(user?.reduced_motion).toBe(!initialValue);
    });
  });

  it('preferences save emits audit entry', async () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    fireEvent.click(screen.getByTestId('profile-preferences-save'));

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'user.profile.update_preferences');
      expect(entry).toBeDefined();
    });
  });

  it('preferences save button disabled without user:update-own', () => {
    grantUpdate = false;
    render(<ProfileSection />, { wrapper: Wrapper });
    const btn = screen.getByTestId<HTMLButtonElement>('profile-preferences-save');
    expect(btn.disabled).toBe(true);
  });

  it('renders all 3 built-in category checkboxes in the preferences subsection', () => {
    render(<ProfileSection />, { wrapper: Wrapper });

    expect(screen.getByTestId('profile-mute-category-system')).toBeDefined();
    expect(screen.getByTestId('profile-mute-category-security')).toBeDefined();
    expect(screen.getByTestId('profile-mute-category-audit')).toBeDefined();
  });

  it('toggling a category and saving writes it to categories_muted and emits audit + host event', async () => {
    const hostEvents: { type: string; payload: unknown }[] = [];
    const listener = (e: Event) => {
      hostEvents.push({ type: (e as CustomEvent).type, payload: (e as CustomEvent).detail });
    };
    mockBus.addEventListener('user:updated', listener);

    render(<ProfileSection />, { wrapper: Wrapper });

    // Click the "security" category checkbox to mute it.
    const securityCheckbox = screen.getByTestId<HTMLInputElement>('profile-mute-category-security');
    fireEvent.click(securityCheckbox);

    fireEvent.click(screen.getByTestId('profile-preferences-save'));

    await waitFor(() => {
      const derrickId = getDerrickId();
      const user = useMockStore.getState().users[derrickId];
      expect(user?.notification_preferences.categories_muted).toContain('security');
    });

    await waitFor(() => {
      const audit = useMockStore.getState().audit;
      const entry = audit.find((a) => a.action === 'user.profile.update_preferences');
      expect(entry).toBeDefined();
    });

    expect(hostEvents.some((e) => e.type === 'user:updated')).toBe(true);

    mockBus.removeEventListener('user:updated', listener);
  });

  it('category checkboxes are disabled when user:update-own is missing', () => {
    grantUpdate = false;
    render(<ProfileSection />, { wrapper: Wrapper });

    const systemCb = screen.getByTestId<HTMLInputElement>('profile-mute-category-system');
    const securityCb = screen.getByTestId<HTMLInputElement>('profile-mute-category-security');
    const auditCb = screen.getByTestId<HTMLInputElement>('profile-mute-category-audit');

    expect(systemCb.disabled).toBe(true);
    expect(securityCb.disabled).toBe(true);
    expect(auditCb.disabled).toBe(true);
  });
});
