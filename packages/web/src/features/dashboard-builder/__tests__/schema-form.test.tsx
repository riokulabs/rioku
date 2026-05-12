/**
 * <SchemaForm> tests — covers each supported Zod primitive + the optional
 * unwrap path + the unsupported-type fallback.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { z } from 'zod';
import { SchemaForm } from '../components/schema-form';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('<SchemaForm>', () => {
  it('renders TextInput for z.string()', () => {
    const schema = z.object({ title: z.string() });
    const onChange = vi.fn();
    wrap(<SchemaForm schema={schema} value={{ title: 'hello' }} onChange={onChange} />);
    const input = screen.getByLabelText(/Title/);
    expect(input).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('hello');
  });

  it('renders NumberInput for z.number().int()', () => {
    const schema = z.object({ count: z.number().int().min(0).max(100) });
    const onChange = vi.fn();
    wrap(<SchemaForm schema={schema} value={{ count: 5 }} onChange={onChange} />);
    expect(screen.getByLabelText(/Count/)).toBeTruthy();
  });

  it('renders Switch for z.boolean()', () => {
    const schema = z.object({ active: z.boolean() });
    const onChange = vi.fn();
    wrap(<SchemaForm schema={schema} value={{ active: true }} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: /Active/ });
    expect((sw as HTMLInputElement).checked).toBe(true);
  });

  it('renders Select for z.enum()', () => {
    const schema = z.object({ kind: z.enum(['apple', 'banana']) });
    const onChange = vi.fn();
    const { container } = wrap(
      <SchemaForm schema={schema} value={{ kind: 'apple' }} onChange={onChange} />,
    );
    // Mantine Select labels via aria-labelledby; assert the label text appears.
    expect(container.textContent).toContain('Kind');
    expect(container.querySelector('[role="combobox"], input')).toBeTruthy();
  });

  it('renders TagsInput for z.array(z.string())', () => {
    const schema = z.object({ tags: z.array(z.string()) });
    const onChange = vi.fn();
    wrap(<SchemaForm schema={schema} value={{ tags: ['a', 'b'] }} onChange={onChange} />);
    expect(screen.getByText('a')).toBeTruthy();
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('unwraps z.optional() and renders the inner type as not required', () => {
    const schema = z.object({ optional_field: z.string().optional() });
    const onChange = vi.fn();
    const { container } = wrap(
      <SchemaForm schema={schema} value={{ optional_field: 'x' }} onChange={onChange} />,
    );
    // The label should appear without a trailing asterisk — no required mark.
    const label = container.querySelector('label');
    expect((label?.textContent ?? '').toLowerCase()).toContain('optional field');
    expect(label?.textContent ?? '').not.toContain('*');
  });

  it('falls back to warning alert for unsupported Zod types', () => {
    const schema = z.object({ bigint_field: z.bigint() });
    const onChange = vi.fn();
    wrap(
      <SchemaForm
        schema={schema}
        value={{ bigint_field: null }}
        onChange={onChange}
      />,
    );
    expect(screen.getByText(/unsupported schema type/i)).toBeTruthy();
  });

  it('emits full updated value on field change', () => {
    const schema = z.object({ title: z.string(), active: z.boolean() });
    const onChange = vi.fn();
    wrap(<SchemaForm schema={schema} value={{ title: 'a', active: false }} onChange={onChange} />);
    const input = screen.getByLabelText(/Title/);
    fireEvent.change(input, { target: { value: 'b' } });
    expect(onChange).toHaveBeenCalledWith({ title: 'b', active: false });
  });

  it('honours custom labels', () => {
    const schema = z.object({ foo: z.string() });
    const onChange = vi.fn();
    wrap(
      <SchemaForm
        schema={schema}
        value={{ foo: '' }}
        onChange={onChange}
        labels={{ foo: 'Custom Label' }}
      />,
    );
    expect(screen.getByLabelText(/Custom Label/)).toBeTruthy();
  });
});
