import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CodeBlock } from '../code-block'

describe('CodeBlock', () => {
  it('renders string value as-is', () => {
    render(<CodeBlock value="hello world" />)

    expect(screen.getByText('hello world')).toBeInTheDocument()
  })

  it('auto-stringifies object value with formatting', () => {
    const obj = { key: 'value', nested: { a: 1 } }
    const { container } = render(<CodeBlock value={obj} />)

    // JSON.stringify with 2-space indent - check the code element
    const code = container.querySelector('code')
    expect(code).toBeInTheDocument()
    expect(code?.textContent).toBe(JSON.stringify(obj, null, 2))
  })

  it('shows language label', () => {
    render(<CodeBlock value="test" language="yaml" />)

    expect(screen.getByText('yaml')).toBeInTheDocument()
  })

  it('defaults to json language label', () => {
    render(<CodeBlock value="test" />)

    expect(screen.getByText('json')).toBeInTheDocument()
  })

  it('copies text to clipboard on copy button click', async () => {
    const user = userEvent.setup()
    render(<CodeBlock value="copy me" />)

    // Spy on clipboard.writeText after userEvent has set up its own clipboard mock
    const writeTextSpy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)

    const copyButton = screen.getByRole('button', { name: /copy/i })
    await user.click(copyButton)

    expect(writeTextSpy).toHaveBeenCalledWith('copy me')
    writeTextSpy.mockRestore()
  })

  it('hides copy button when copyable is false', () => {
    render(<CodeBlock value="no copy" copyable={false} />)

    expect(
      screen.queryByRole('button', { name: /copy/i }),
    ).not.toBeInTheDocument()
  })

  it('applies maxHeight style to pre element', () => {
    const { container } = render(
      <CodeBlock value="test" maxHeight="200px" />,
    )

    const pre = container.querySelector('pre')
    expect(pre).toHaveStyle({ maxHeight: '200px' })
  })

  it('does not set maxHeight when not provided', () => {
    const { container } = render(<CodeBlock value="test" />)

    const pre = container.querySelector('pre')
    expect(pre).not.toHaveStyle({ maxHeight: expect.anything() })
  })
})
