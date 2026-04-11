import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Mock CodeMirror — it relies on browser APIs not available in happy-dom.
// We test our custom toolbar/controls, not upstream CodeMirror behavior.
vi.mock('@uiw/react-codemirror', () => ({
  __esModule: true,
  default: (props: {
    value?: string
    onChange?: (val: string) => void
    editable?: boolean
    'data-testid'?: string
  }) => (
    <textarea
      data-testid={props['data-testid'] ?? 'codemirror-mock'}
      value={props.value}
      readOnly={props.editable === false}
      onChange={(e) => props.onChange?.(e.target.value)}
    />
  ),
  EditorView: { theme: () => ({}) },
}))

vi.mock('@codemirror/lang-json', () => ({
  json: () => ({}),
}))

vi.mock('@codemirror/lang-yaml', () => ({
  yaml: () => ({}),
}))

vi.mock('@codemirror/lint', () => ({
  linter: () => ({}),
}))

import { YamlJsonEditor } from '../yaml-json-editor'

const validYaml = `name: test
version: 1
`

const validJson = `{
  "name": "test",
  "version": 1
}`

const invalidYaml = `name: test
  bad indent:
    - [broken`

const invalidJson = `{ "name": "test", bad }`

describe('YamlJsonEditor', () => {
  beforeEach(() => {
    // Stub clipboard API — navigator.clipboard is read-only in happy-dom,
    // so we use defineProperty to override it.
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })
  })

  it('renders the editor with YAML mode active by default', () => {
    render(<YamlJsonEditor value={validYaml} onChange={() => {}} />)

    const yamlBtn = screen.getByRole('button', { name: 'YAML' })
    expect(yamlBtn).toHaveAttribute('aria-pressed', 'true')

    const jsonBtn = screen.getByRole('button', { name: 'JSON' })
    expect(jsonBtn).toHaveAttribute('aria-pressed', 'false')
  })

  it('renders the format toggle (YAML / JSON) buttons', () => {
    render(<YamlJsonEditor value={validYaml} onChange={() => {}} />)

    expect(screen.getByRole('button', { name: 'YAML' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'JSON' })).toBeInTheDocument()
  })

  it('renders toolbar with copy and format buttons', () => {
    render(<YamlJsonEditor value={validYaml} onChange={() => {}} />)

    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Format' })).toBeInTheDocument()
  })

  it('shows Valid indicator when content is valid YAML', () => {
    render(<YamlJsonEditor value={validYaml} onChange={() => {}} />)

    expect(screen.getByText('Valid')).toBeInTheDocument()
  })

  it('shows Valid indicator when content is valid JSON', () => {
    render(
      <YamlJsonEditor value={validJson} onChange={() => {}} format="json" />,
    )

    expect(screen.getByText('Valid')).toBeInTheDocument()
  })

  it('shows error indicator when content is invalid YAML', () => {
    render(<YamlJsonEditor value={invalidYaml} onChange={() => {}} />)

    // Should show error count text (not "Valid")
    expect(screen.queryByText('Valid')).not.toBeInTheDocument()
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })

  it('shows error indicator when content is invalid JSON', () => {
    render(
      <YamlJsonEditor
        value={invalidJson}
        onChange={() => {}}
        format="json"
      />,
    )

    expect(screen.queryByText('Valid')).not.toBeInTheDocument()
    expect(screen.getByText(/error/i)).toBeInTheDocument()
  })

  it('calls onChange when content changes', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()

    render(<YamlJsonEditor value={validYaml} onChange={onChange} />)

    const editor = screen.getByTestId('codemirror-mock')
    await user.clear(editor)
    await user.type(editor, 'new content')

    expect(onChange).toHaveBeenCalled()
  })

  it('renders download button when showDownload is provided', () => {
    render(
      <YamlJsonEditor
        value={validYaml}
        onChange={() => {}}
        showDownload
        downloadFilename="config.yaml"
      />,
    )

    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument()
  })

  it('does not render download button by default', () => {
    render(<YamlJsonEditor value={validYaml} onChange={() => {}} />)

    expect(
      screen.queryByRole('button', { name: 'Download' }),
    ).not.toBeInTheDocument()
  })

  it('respects readOnly prop', () => {
    render(
      <YamlJsonEditor value={validYaml} onChange={() => {}} readOnly />,
    )

    const editor = screen.getByTestId('codemirror-mock')
    expect(editor).toHaveAttribute('readOnly')
  })

  it('switches format from YAML to JSON when JSON button is clicked', async () => {
    const user = userEvent.setup()
    const onFormatChange = vi.fn()

    render(
      <YamlJsonEditor
        value={validYaml}
        onChange={() => {}}
        onFormatChange={onFormatChange}
      />,
    )

    const jsonBtn = screen.getByRole('button', { name: 'JSON' })
    await user.click(jsonBtn)

    expect(onFormatChange).toHaveBeenCalledWith('json')
  })

  it('switches format from JSON to YAML when YAML button is clicked', async () => {
    const user = userEvent.setup()
    const onFormatChange = vi.fn()

    render(
      <YamlJsonEditor
        value={validJson}
        onChange={() => {}}
        format="json"
        onFormatChange={onFormatChange}
      />,
    )

    const yamlBtn = screen.getByRole('button', { name: 'YAML' })
    await user.click(yamlBtn)

    expect(onFormatChange).toHaveBeenCalledWith('yaml')
  })

  it('copies content to clipboard when copy button is clicked', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      writable: true,
      configurable: true,
    })

    render(<YamlJsonEditor value={validYaml} onChange={() => {}} />)

    const copyBtn = screen.getByRole('button', { name: 'Copy' })
    await user.click(copyBtn)

    expect(writeText).toHaveBeenCalledWith(validYaml)
  })

  it('formats/prettifies valid JSON content when format button is clicked', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const compactJson = '{"name":"test","version":1}'

    render(
      <YamlJsonEditor
        value={compactJson}
        onChange={onChange}
        format="json"
      />,
    )

    const formatBtn = screen.getByRole('button', { name: 'Format' })
    await user.click(formatBtn)

    expect(onChange).toHaveBeenCalledWith(
      JSON.stringify(JSON.parse(compactJson), null, 2),
    )
  })
})
