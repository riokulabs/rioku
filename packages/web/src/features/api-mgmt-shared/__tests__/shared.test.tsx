/**
 * Tests for the shared API-mgmt helpers + atomic components.
 */
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '@/test/render';
import {
  ProtocolBadge,
  HealthChip,
  TagsInput,
  formatUpstreamUrl,
  buildMatchPreview,
  isDestructiveMiddleware,
} from '..';

describe('formatUpstreamUrl', () => {
  it('formats with explicit port', () => {
    expect(formatUpstreamUrl('http', 'api.local', 8080)).toBe('http://api.local:8080');
    expect(formatUpstreamUrl('https', 'api.local', 443)).toBe('https://api.local:443');
    expect(formatUpstreamUrl('grpc', 'mcp.local', 50051)).toBe('grpc://mcp.local:50051');
  });

  it('omits port when undefined', () => {
    expect(formatUpstreamUrl('http', 'api.local')).toBe('http://api.local');
    expect(formatUpstreamUrl('https', 'api.local')).toBe('https://api.local');
    expect(formatUpstreamUrl('grpc', 'mcp.local')).toBe('grpc://mcp.local');
  });

  it('returns empty string when host is empty', () => {
    expect(formatUpstreamUrl('http', '')).toBe('');
  });
});

describe('buildMatchPreview', () => {
  it('composes method + match_kind + path', () => {
    expect(buildMatchPreview('GET', 'prefix', '/api')).toBe('GET prefix:/api');
    expect(buildMatchPreview('ANY', 'exact', '/foo')).toBe('ANY exact:/foo');
    expect(buildMatchPreview('POST', 'regex', '^/v1/.*$')).toBe('POST regex:^/v1/.*$');
  });
});

describe('isDestructiveMiddleware', () => {
  it('returns true for auth and transform', () => {
    expect(isDestructiveMiddleware('auth')).toBe(true);
    expect(isDestructiveMiddleware('transform')).toBe(true);
  });

  it('returns false for non-destructive kinds', () => {
    expect(isDestructiveMiddleware('rate-limit')).toBe(false);
    expect(isDestructiveMiddleware('cors')).toBe(false);
    expect(isDestructiveMiddleware('cache')).toBe(false);
    expect(isDestructiveMiddleware('logging')).toBe(false);
    expect(isDestructiveMiddleware('custom')).toBe(false);
  });
});

describe('ProtocolBadge', () => {
  it('renders protocol name uppercased', () => {
    renderWithProviders(<ProtocolBadge kind="http" />);
    expect(screen.getByText('HTTP')).toBeInTheDocument();
  });

  it('renders grpc uppercased', () => {
    renderWithProviders(<ProtocolBadge kind="grpc" />);
    expect(screen.getByText('GRPC')).toBeInTheDocument();
  });
});

describe('HealthChip', () => {
  it('renders healthy status label', () => {
    renderWithProviders(<HealthChip status="healthy" />);
    expect(screen.getByText('healthy')).toBeInTheDocument();
  });

  it('renders degraded status label', () => {
    renderWithProviders(<HealthChip status="degraded" />);
    expect(screen.getByText('degraded')).toBeInTheDocument();
  });

  it('renders unhealthy status label', () => {
    renderWithProviders(<HealthChip status="unhealthy" />);
    expect(screen.getByText('unhealthy')).toBeInTheDocument();
  });

  it('renders disabled status label', () => {
    renderWithProviders(<HealthChip status="disabled" />);
    expect(screen.getByText('disabled')).toBeInTheDocument();
  });
});

describe('TagsInput', () => {
  it('renders the Mantine TagsInput with initial values', () => {
    const onChange = vi.fn();
    renderWithProviders(<TagsInput values={['alpha', 'beta']} onChange={onChange} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('passes through a custom placeholder', () => {
    renderWithProviders(
      <TagsInput values={[]} onChange={vi.fn()} placeholder="Custom placeholder" />,
    );
    expect(
      (screen.getByPlaceholderText('Custom placeholder') as HTMLInputElement).placeholder,
    ).toBe('Custom placeholder');
  });

  it('uses a default placeholder when none is provided', () => {
    renderWithProviders(<TagsInput values={[]} onChange={vi.fn()} />);
    expect(screen.getByPlaceholderText('Add tags…')).toBeInTheDocument();
  });

  it('invokes onChange when a tag is added via Enter', () => {
    const onChange = vi.fn();
    renderWithProviders(<TagsInput values={['one']} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Add tags…') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'two' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    expect(onChange).toHaveBeenCalled();
  });
});
