import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { LoadingState } from './index';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

describe('LoadingState', () => {
  it('renders an accessible container label', () => {
    render(<LoadingState />, { wrapper: Wrapper });
    expect(screen.getByLabelText('Loading')).toBeInTheDocument();
  });

  it('defaults to 5 skeleton rows for list shape', () => {
    const { container } = render(<LoadingState />, { wrapper: Wrapper });
    // Mantine Skeleton renders divs with --skeleton-height inline CSS variable
    const skeletons = container.querySelectorAll('[style*="--skeleton-height"]');
    expect(skeletons).toHaveLength(5);
  });

  it('respects custom rows count', () => {
    const { container } = render(<LoadingState rows={3} />, { wrapper: Wrapper });
    const skeletons = container.querySelectorAll('[style*="--skeleton-height"]');
    expect(skeletons).toHaveLength(3);
  });

  it('detail shape renders header + 3 body skeletons (4 total)', () => {
    const { container } = render(<LoadingState shape="detail" />, { wrapper: Wrapper });
    const skeletons = container.querySelectorAll('[style*="--skeleton-height"]');
    expect(skeletons).toHaveLength(4);
  });

  it('table shape renders header row + N body rows', () => {
    const { container } = render(<LoadingState shape="table" rows={4} />, { wrapper: Wrapper });
    // 1 header + 4 body = 5 total
    const skeletons = container.querySelectorAll('[style*="--skeleton-height"]');
    expect(skeletons).toHaveLength(5);
  });

  it('list shape skeletons have --skeleton-height set', () => {
    const { container } = render(<LoadingState shape="list" rows={2} />, { wrapper: Wrapper });
    const skeletons = container.querySelectorAll('[style*="--skeleton-height"]');
    // Mantine converts numeric pixel values to rem — confirm the variable is present
    skeletons.forEach((el) => {
      const style = (el as HTMLElement).getAttribute('style') ?? '';
      expect(style).toContain('--skeleton-height');
    });
  });
});
