import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './app';

describe('App', () => {
  it('renders the tenants page after root redirect', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /tenants/i })).toBeInTheDocument();
  });
});
