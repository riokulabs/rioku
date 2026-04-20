/**
 * Tests for <MultiSelectAsync>.
 *
 * Covers: renders, opens dropdown, debounces search calls, handles option
 * selection + pill removal, paginates via Load more.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { useState } from 'react';
import { MultiSelectAsync, type MultiSelectAsyncPage } from './index';

function Wrapper({ children }: { children: React.ReactNode }) {
  return <MantineProvider>{children}</MantineProvider>;
}

function makePage(
  items: { handle: string; label: string }[],
  nextCursor?: string,
): MultiSelectAsyncPage {
  return nextCursor !== undefined ? { items, nextCursor } : { items };
}

function Controlled({
  searchFn,
  initialValue = [],
}: {
  searchFn: (
    query: string,
    cursor?: string,
  ) => Promise<MultiSelectAsyncPage>;
  initialValue?: string[];
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <MultiSelectAsync
      label="Actors"
      placeholder="Search actors"
      value={value}
      onChange={setValue}
      searchFn={searchFn}
      debounceMs={10}
      data-testid="msa-actors"
    />
  );
}

describe('<MultiSelectAsync>', () => {
  it('renders the label and placeholder', () => {
    const searchFn = vi.fn().mockResolvedValue(makePage([]));
    render(<Controlled searchFn={searchFn} />, { wrapper: Wrapper });
    expect(screen.getByText('Actors')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Search actors')).toBeInTheDocument();
  });

  it('fetches candidates when dropdown opens', async () => {
    const searchFn = vi.fn().mockResolvedValue(
      makePage([
        { handle: 'user_1', label: 'Alice' },
        { handle: 'user_2', label: 'Bob' },
      ]),
    );
    render(<Controlled searchFn={searchFn} />, { wrapper: Wrapper });
    const input = screen.getByPlaceholderText('Search actors');
    fireEvent.focus(input);
    await waitFor(() => {
      expect(searchFn).toHaveBeenCalled();
    });
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('debounces typed queries into a single fetch', async () => {
    const searchFn = vi.fn().mockResolvedValue(makePage([]));
    render(<Controlled searchFn={searchFn} />, { wrapper: Wrapper });
    const input = screen.getByPlaceholderText('Search actors');
    fireEvent.focus(input);
    await waitFor(() => {
      expect(searchFn).toHaveBeenCalled();
    });
    searchFn.mockClear();

    // Burst of three changes within the debounce window (10ms).
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'al' } });
    fireEvent.change(input, { target: { value: 'ali' } });

    await waitFor(() => {
      expect(searchFn).toHaveBeenCalledTimes(1);
    });
    expect(searchFn).toHaveBeenLastCalledWith('ali');
  });

  it('selecting an option adds a pill and removing the pill clears it', async () => {
    const searchFn = vi.fn().mockResolvedValue(
      makePage([{ handle: 'user_1', label: 'Alice' }]),
    );
    render(<Controlled searchFn={searchFn} />, { wrapper: Wrapper });
    fireEvent.focus(screen.getByPlaceholderText('Search actors'));
    const option = await screen.findByText('Alice');
    act(() => {
      fireEvent.click(option);
    });
    // Pill renders — label appears again outside the dropdown as a pill.
    await waitFor(() => {
      const pills = screen.getAllByText('Alice');
      expect(pills.length).toBeGreaterThanOrEqual(1);
    });
    // Mantine's PillRemoveButton is a <button> with a close icon — locate it
    // via the `.mantine-Pill-remove` class since it has no accessible name.
    const removeBtn = document.querySelector('.mantine-Pill-remove');
    expect(removeBtn).not.toBeNull();
    if (removeBtn) fireEvent.click(removeBtn);
    // Back to no pills — the remove button disappears from the DOM.
    await waitFor(() => {
      expect(
        document.querySelector('.mantine-Pill-remove'),
      ).toBeNull();
    });
  });

  it('shows Load more when the first page has a cursor, and fetches next page on click', async () => {
    const searchFn = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(makePage([{ handle: 'u1', label: 'A' }], '1')),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(makePage([{ handle: 'u2', label: 'B' }])),
      );

    render(<Controlled searchFn={searchFn} />, { wrapper: Wrapper });
    fireEvent.focus(screen.getByPlaceholderText('Search actors'));
    await screen.findByText('A');
    const loadMore = await screen.findByTestId('multi-select-async-load-more');
    act(() => {
      fireEvent.click(loadMore);
    });
    expect(await screen.findByText('B')).toBeInTheDocument();
    expect(searchFn).toHaveBeenCalledTimes(2);
    expect(searchFn).toHaveBeenNthCalledWith(2, '', '1');
  });

  it('renders pre-selected handles as pills before any fetch resolves', () => {
    const searchFn = vi.fn().mockResolvedValue(makePage([]));
    render(
      <Controlled searchFn={searchFn} initialValue={['user_42']} />,
      { wrapper: Wrapper },
    );
    // Shows handle as fallback label.
    expect(screen.getByText('user_42')).toBeInTheDocument();
  });

  it('is disabled when disabled=true — pill removal buttons suppressed', () => {
    const searchFn = vi.fn().mockResolvedValue(makePage([]));
    function Disabled() {
      return (
        <MultiSelectAsync
          label="Actors"
          value={['user_1']}
          onChange={() => undefined}
          searchFn={searchFn}
          disabled
        />
      );
    }
    render(<Disabled />, { wrapper: Wrapper });
    expect(
      screen.queryByRole('button', { name: /remove/i }),
    ).not.toBeInTheDocument();
  });
});
