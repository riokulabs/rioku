import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { App } from './app';

describe('App', () => {
  it('renders hello', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /hello/i })).toBeInTheDocument();
  });
});
