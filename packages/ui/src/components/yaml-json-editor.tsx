import { useCallback, useMemo } from 'react'
import CodeMirror, { EditorView } from '@uiw/react-codemirror'
import { json } from '@codemirror/lang-json'
import { yaml as yamlLang } from '@codemirror/lang-yaml'
import { linter } from '@codemirror/lint'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { cn } from '@ui/lib/utils'

/** Props for the YamlJsonEditor component. */
export interface YamlJsonEditorProps {
  /** The editor content as a string */
  value: string
  /** Called when the editor content changes */
  onChange: (value: string) => void
  /** Active format mode (default: 'yaml') */
  format?: 'yaml' | 'json'
  /** Called when the user toggles between YAML and JSON */
  onFormatChange?: (format: 'yaml' | 'json') => void
  /** Whether the editor is read-only */
  readOnly?: boolean
  /** Whether to show the download button in the toolbar */
  showDownload?: boolean
  /** Filename used when downloading the content */
  downloadFilename?: string
  /** CSS height for the editor (default: '300px') */
  height?: string
  /** Additional CSS class names */
  className?: string
}

/** Validate content and return an error message or null if valid. */
function validate(
  content: string,
  format: 'yaml' | 'json',
): string | null {
  if (!content.trim()) return null
  try {
    if (format === 'json') {
      JSON.parse(content)
    } else {
      parseYaml(content, { strict: true })
    }
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Parse error'
  }
}

/** Custom CodeMirror theme using CSS variables. */
const riokuTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)',
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--accent)',
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--muted)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--secondary)',
    color: 'var(--muted-foreground)',
    borderRight: '1px solid var(--border)',
  },
})

/** A linter that validates JSON content. */
function jsonLinter() {
  return linter((view) => {
    const content = view.state.doc.toString()
    if (!content.trim()) return []
    try {
      JSON.parse(content)
      return []
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON'
      return [
        {
          from: 0,
          to: content.length,
          severity: 'error' as const,
          message: msg,
        },
      ]
    }
  })
}

/** A linter that validates YAML content. */
function yamlLinter() {
  return linter((view) => {
    const content = view.state.doc.toString()
    if (!content.trim()) return []
    try {
      parseYaml(content, { strict: true })
      return []
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Invalid YAML'
      return [
        {
          from: 0,
          to: content.length,
          severity: 'error' as const,
          message: msg,
        },
      ]
    }
  })
}

/**
 * A YAML/JSON code editor with a toolbar for format toggling,
 * validation, copy, prettify, and download.
 *
 * Wraps @uiw/react-codemirror with Rioku-specific controls.
 */
export function YamlJsonEditor({
  value,
  onChange,
  format = 'yaml',
  onFormatChange,
  readOnly = false,
  showDownload = false,
  downloadFilename = 'config',
  height = '300px',
  className,
}: YamlJsonEditorProps) {
  const error = useMemo(() => validate(value, format), [value, format])

  const extensions = useMemo(() => {
    const base = [riokuTheme]
    if (format === 'json') {
      return [...base, json(), jsonLinter()]
    }
    return [...base, yamlLang(), yamlLinter()]
  }, [format])

  const handleFormatSwitch = useCallback(
    (newFormat: 'yaml' | 'json') => {
      if (newFormat === format) return

      // Try to convert content between formats
      let converted = value
      try {
        if (newFormat === 'json') {
          // YAML -> JSON
          const parsed = parseYaml(value)
          converted = JSON.stringify(parsed, null, 2)
        } else {
          // JSON -> YAML
          const parsed = JSON.parse(value)
          converted = stringifyYaml(parsed, { indent: 2 })
        }
        onChange(converted)
      } catch {
        // If conversion fails, keep the original content
      }

      onFormatChange?.(newFormat)
    },
    [format, value, onChange, onFormatChange],
  )

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value)
  }, [value])

  const handleFormat = useCallback(() => {
    try {
      if (format === 'json') {
        const parsed = JSON.parse(value)
        onChange(JSON.stringify(parsed, null, 2))
      } else {
        const parsed = parseYaml(value)
        onChange(stringifyYaml(parsed, { indent: 2 }))
      }
    } catch {
      // Cannot format invalid content
    }
  }, [format, value, onChange])

  const handleDownload = useCallback(() => {
    const ext = format === 'json' ? '.json' : '.yaml'
    const filename = downloadFilename.endsWith(ext)
      ? downloadFilename
      : `${downloadFilename}${ext}`
    const blob = new Blob([value], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }, [value, format, downloadFilename])

  return (
    <div className={cn('flex flex-col rounded-md border border-[var(--border)]', className)}>
      {/* Toolbar */}
      <div
        className={cn(
          'flex items-center gap-2 border-b border-[var(--border)] px-2 py-1',
          'bg-[var(--secondary)]',
        )}
      >
        {/* Format toggle */}
        <div className="flex items-center rounded-md border border-[var(--border)]">
          <button
            type="button"
            aria-pressed={format === 'yaml'}
            onClick={() => handleFormatSwitch('yaml')}
            className={cn(
              'px-2 py-0.5 text-xs font-medium',
              'rounded-l-md',
              format === 'yaml'
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            )}
          >
            YAML
          </button>
          <button
            type="button"
            aria-pressed={format === 'json'}
            onClick={() => handleFormatSwitch('json')}
            className={cn(
              'px-2 py-0.5 text-xs font-medium',
              'rounded-r-md',
              format === 'json'
                ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                : 'bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            )}
          >
            JSON
          </button>
        </div>

        {/* Validity indicator */}
        <span
          className={cn(
            'text-xs font-medium',
            error
              ? 'text-[var(--destructive)]'
              : 'text-[var(--success, #22c55e)]',
          )}
        >
          {error ? '1 error' : 'Valid'}
        </span>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Action buttons */}
        <button
          type="button"
          aria-label="Copy"
          onClick={handleCopy}
          className={cn(
            'rounded px-2 py-0.5 text-xs',
            'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            'hover:bg-[var(--muted)]',
          )}
        >
          Copy
        </button>

        <button
          type="button"
          aria-label="Format"
          onClick={handleFormat}
          className={cn(
            'rounded px-2 py-0.5 text-xs',
            'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
            'hover:bg-[var(--muted)]',
          )}
        >
          Format
        </button>

        {showDownload && (
          <button
            type="button"
            aria-label="Download"
            onClick={handleDownload}
            className={cn(
              'rounded px-2 py-0.5 text-xs',
              'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
              'hover:bg-[var(--muted)]',
            )}
          >
            Download
          </button>
        )}
      </div>

      {/* Editor */}
      <CodeMirror
        data-testid="codemirror-mock"
        value={value}
        onChange={onChange}
        height={height}
        theme="dark"
        extensions={extensions}
        editable={!readOnly}
        basicSetup={{
          lineNumbers: true,
          tabSize: 2,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          foldGutter: true,
        }}
      />
    </div>
  )
}
