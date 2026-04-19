import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@mantine/notifications', () => ({
  notifications: {
    show: vi.fn(),
  },
}));

import { notifications } from '@mantine/notifications';
import { notify } from './use-notify';

describe('notify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('notify.success fires with green color and 4s autoClose', () => {
    notify.success('Saved', 'Record saved successfully');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        color: 'green',
        title: 'Saved',
        message: 'Record saved successfully',
        autoClose: 4000,
      }),
    );
  });

  it('notify.info fires with blue color', () => {
    notify.info('FYI');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'blue', title: 'FYI', autoClose: 4000 }),
    );
  });

  it('notify.warn fires with yellow color and 6s autoClose', () => {
    notify.warn('Heads up', 'Quota nearly reached');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'yellow', autoClose: 6000 }),
    );
  });

  it('notify.error fires with red color and 8s autoClose', () => {
    notify.error('Failed', 'Something broke');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ color: 'red', autoClose: 8000 }),
    );
  });

  it('notify.error appends correlationId to message', () => {
    notify.error('Failed', 'Upstream timeout', { correlationId: 'corr-xyz' });
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('corr-xyz') as string,
      }),
    );
  });

  it('notify.error works with no message but with correlationId', () => {
    notify.error('Error', undefined, { correlationId: 'corr-abc' });
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('corr-abc') as string,
      }),
    );
  });
});
