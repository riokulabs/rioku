import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { App } from './app';
import { useMockStore } from '@/api/mock-store';

describe('App', () => {
  beforeEach(() => {
    // /tenants now requires auth — seed Derrick as the current user so
    // the route's `beforeLoad` guard passes instead of redirecting to /login.
    const derrick = Object.values(useMockStore.getState().users).find(
      (u) => u.email === 'derrick@rioku.dev',
    );
    useMockStore.setState({ currentUserId: derrick?.id ?? 'user-0001' });
  });

  it('renders the tenants page after root redirect', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /tenants/i })).toBeInTheDocument();
  });
});
