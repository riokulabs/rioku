/**
 * Unit tests for <JsonSchemaEditor>.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({
  useSearch: () => ({}),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ navigate: vi.fn() }),
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { JsonSchemaEditor } from '../components/json-schema-editor';

function wrap(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

describe('JsonSchemaEditor', () => {
  it('calls onChange when valid JSON is entered and blurred', () => {
    const onChange = vi.fn();
    const onValidityChange = vi.fn();
    wrap(
      <JsonSchemaEditor
        value={{ type: 'object', properties: {} }}
        onChange={onChange}
        onValidityChange={onValidityChange}
      />,
    );
    const textarea = screen.getByLabelText('JSON schema editor');
    fireEvent.change(textarea, {
      target: { value: '{"type":"object","properties":{"name":{"type":"string"}}}' },
    });
    fireEvent.blur(textarea);
    expect(onChange).toHaveBeenCalled();
    expect(onValidityChange).toHaveBeenCalledWith(true);
  });

  it('reports invalid when JSON is malformed', () => {
    const onValidityChange = vi.fn();
    wrap(
      <JsonSchemaEditor
        value={{ type: 'object' }}
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    const textarea = screen.getByLabelText('JSON schema editor');
    fireEvent.change(textarea, { target: { value: '{not-valid' } });
    fireEvent.blur(textarea);
    expect(onValidityChange).toHaveBeenCalledWith(false);
  });

  it('reports invalid when schema is an array', () => {
    const onValidityChange = vi.fn();
    wrap(
      <JsonSchemaEditor
        value={{ type: 'object' }}
        onChange={vi.fn()}
        onValidityChange={onValidityChange}
      />,
    );
    const textarea = screen.getByLabelText('JSON schema editor');
    fireEvent.change(textarea, { target: { value: '[1,2,3]' } });
    fireEvent.blur(textarea);
    expect(onValidityChange).toHaveBeenCalledWith(false);
  });
});
