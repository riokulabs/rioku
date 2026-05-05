import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { DestructiveConfirmModal } from './destructive-confirm-modal';

const wrap = (ui: React.ReactNode) => render(<MantineProvider>{ui}</MantineProvider>);

describe('DestructiveConfirmModal', () => {
  it('@read-only renders nothing when closed', () => {
    wrap(
      <DestructiveConfirmModal
        open={false}
        method="DELETE"
        path="/x"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.queryByText(/confirm destructive request/i)).not.toBeInTheDocument();
  });

  it('@read-only renders method + path when open', () => {
    wrap(
      <DestructiveConfirmModal
        open={true}
        method="DELETE"
        path="/api/v1/services/123"
        onCancel={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText(/confirm destructive request/i)).toBeInTheDocument();
    expect(screen.getByText('DELETE /api/v1/services/123')).toBeInTheDocument();
  });

  it('@read-only fires onConfirm when "Send anyway" clicked', () => {
    const onConfirm = vi.fn();
    wrap(
      <DestructiveConfirmModal
        open={true}
        method="POST"
        path="/x"
        onCancel={() => {}}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /send anyway/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('@read-only fires onCancel when "Cancel" clicked', () => {
    const onCancel = vi.fn();
    wrap(
      <DestructiveConfirmModal
        open={true}
        method="DELETE"
        path="/x"
        onCancel={onCancel}
        onConfirm={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
