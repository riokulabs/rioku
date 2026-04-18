import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './app';

describe('App', () => {
  it('renders hello through the router', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: /hello/i })).toBeInTheDocument();
  });
});
