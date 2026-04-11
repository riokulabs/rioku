import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { cn } from '@ui/lib/utils'

/** An option in the searchable select dropdown. */
export interface SelectOption {
  /** Unique value for this option */
  value: string
  /** Display label */
  label: string
  /** Optional description shown below the label */
  description?: string
  /** Optional badge text shown to the right of the label */
  badge?: string
  /** Whether this option is disabled */
  disabled?: boolean
}

/** Props for the single-value SearchableSelect component. */
export interface SearchableSelectProps {
  /** Available options to select from */
  options: SelectOption[]
  /** Currently selected value */
  value: string
  /** Called when the selected value changes */
  onChange: (value: string) => void
  /** Placeholder text when no value is selected */
  placeholder?: string
  /** Whether the component is disabled */
  disabled?: boolean
  /** Additional CSS class names */
  className?: string
}

/** Props for the multi-value SearchableMultiSelect component. */
export interface SearchableMultiSelectProps {
  /** Available options to select from */
  options: SelectOption[]
  /** Currently selected values */
  value: string[]
  /** Called when the selected values change */
  onChange: (value: string[]) => void
  /** Placeholder text when no values are selected */
  placeholder?: string
  /** Whether the component is disabled */
  disabled?: boolean
  /** Additional CSS class names */
  className?: string
}

/**
 * A searchable single-select combobox.
 *
 * Renders a text input that filters a dropdown list of options.
 * Supports keyboard navigation (ArrowUp/Down, Enter, Escape).
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  disabled = false,
  className,
}: SearchableSelectProps) {
  const id = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const selectedOption = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  )

  const filteredOptions = useMemo(() => {
    if (!query) return options
    const lower = query.toLowerCase()
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(lower) ||
        o.description?.toLowerCase().includes(lower),
    )
  }, [options, query])

  // Reset highlighted index when filtered options change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [filteredOptions.length])

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value)
      if (!isOpen) setIsOpen(true)
    },
    [isOpen],
  )

  const handleSelect = useCallback(
    (optionValue: string) => {
      onChange(optionValue)
      setIsOpen(false)
      setQuery('')
      inputRef.current?.blur()
    },
    [onChange],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        setIsOpen(true)
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            prev < filteredOptions.length - 1 ? prev + 1 : prev,
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev))
          break
        case 'Enter':
          e.preventDefault()
          if (
            highlightedIndex >= 0 &&
            highlightedIndex < filteredOptions.length
          ) {
            const option = filteredOptions[highlightedIndex]
            if (!option.disabled) {
              handleSelect(option.value)
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          setQuery('')
          break
      }
    },
    [isOpen, filteredOptions, highlightedIndex, handleSelect],
  )

  const activeDescendant =
    highlightedIndex >= 0
      ? `${id}-option-${highlightedIndex}`
      : undefined

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={isOpen ? `${id}-listbox` : undefined}
        aria-activedescendant={activeDescendant}
        type="text"
        value={isOpen ? query : selectedOption?.label ?? ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={handleInputChange}
        onFocus={() => {
          setIsOpen(true)
          setQuery('')
        }}
        onKeyDown={handleKeyDown}
        className={cn(
          'w-full rounded-md border px-3 py-2 text-sm',
          'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)]',
          'placeholder:text-[var(--muted-foreground)]',
          'focus:outline-none focus:ring-2 focus:ring-[var(--ring)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      />

      {isOpen && filteredOptions.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className={cn(
            'absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border',
            'border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)]',
            'shadow-md',
          )}
        >
          {filteredOptions.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled}
              onMouseDown={(e) => {
                e.preventDefault()
                if (!option.disabled) handleSelect(option.value)
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                index === highlightedIndex &&
                  'bg-[var(--accent)] text-[var(--accent-foreground)]',
                option.value === value && 'font-medium',
                option.disabled &&
                  'cursor-not-allowed opacity-50',
              )}
            >
              <div className="flex items-center justify-between">
                <span>{option.label}</span>
                {option.badge && (
                  <span
                    className={cn(
                      'ml-2 rounded-full px-2 py-0.5 text-xs',
                      'bg-[var(--secondary)] text-[var(--secondary-foreground)]',
                    )}
                  >
                    {option.badge}
                  </span>
                )}
              </div>
              {option.description && (
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {option.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * A searchable multi-select combobox.
 *
 * Renders selected values as removable badges above a text input
 * that filters a dropdown list of remaining options.
 * Supports keyboard navigation (ArrowUp/Down, Enter, Escape).
 */
export function SearchableMultiSelect({
  options,
  value,
  onChange,
  placeholder = 'Search...',
  disabled = false,
  className,
}: SearchableMultiSelectProps) {
  const id = useId()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)

  const selectedOptions = useMemo(
    () => options.filter((o) => value.includes(o.value)),
    [options, value],
  )

  const availableOptions = useMemo(() => {
    const selected = new Set(value)
    let filtered = options.filter((o) => !selected.has(o.value))
    if (query) {
      const lower = query.toLowerCase()
      filtered = filtered.filter(
        (o) =>
          o.label.toLowerCase().includes(lower) ||
          o.description?.toLowerCase().includes(lower),
      )
    }
    return filtered
  }, [options, value, query])

  // Reset highlighted index when available options change
  useEffect(() => {
    setHighlightedIndex(-1)
  }, [availableOptions.length])

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value)
      if (!isOpen) setIsOpen(true)
    },
    [isOpen],
  )

  const handleAdd = useCallback(
    (optionValue: string) => {
      onChange([...value, optionValue])
      setQuery('')
      inputRef.current?.focus()
    },
    [onChange, value],
  )

  const handleRemove = useCallback(
    (optionValue: string) => {
      onChange(value.filter((v) => v !== optionValue))
    },
    [onChange, value],
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        setIsOpen(true)
        return
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((prev) =>
            prev < availableOptions.length - 1 ? prev + 1 : prev,
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : prev))
          break
        case 'Enter':
          e.preventDefault()
          if (
            highlightedIndex >= 0 &&
            highlightedIndex < availableOptions.length
          ) {
            const option = availableOptions[highlightedIndex]
            if (!option.disabled) {
              handleAdd(option.value)
            }
          }
          break
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          setQuery('')
          break
        case 'Backspace':
          if (!query && value.length > 0) {
            onChange(value.slice(0, -1))
          }
          break
      }
    },
    [isOpen, availableOptions, highlightedIndex, handleAdd, query, value, onChange],
  )

  const activeDescendant =
    highlightedIndex >= 0
      ? `${id}-option-${highlightedIndex}`
      : undefined

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <div
        className={cn(
          'flex min-h-[2.5rem] flex-wrap items-center gap-1 rounded-md border px-2 py-1',
          'border-[var(--border)] bg-[var(--background)]',
          'focus-within:ring-2 focus-within:ring-[var(--ring)]',
          disabled && 'cursor-not-allowed opacity-50',
        )}
      >
        {selectedOptions.map((option) => (
          <span
            key={option.value}
            className={cn(
              'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm',
              'bg-[var(--secondary)] text-[var(--secondary-foreground)]',
            )}
          >
            {option.label}
            <button
              type="button"
              aria-label={`Remove ${option.label}`}
              disabled={disabled}
              onClick={() => handleRemove(option.value)}
              className={cn(
                'ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full',
                'hover:bg-[var(--muted)] focus:outline-none',
                'disabled:cursor-not-allowed',
              )}
            >
              &times;
            </button>
          </span>
        ))}

        <input
          ref={inputRef}
          role="combobox"
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-controls={isOpen ? `${id}-listbox` : undefined}
          aria-activedescendant={activeDescendant}
          type="text"
          value={query}
          placeholder={value.length === 0 ? placeholder : ''}
          disabled={disabled}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          className={cn(
            'min-w-[4rem] flex-1 border-none bg-transparent py-1 text-sm',
            'text-[var(--foreground)] placeholder:text-[var(--muted-foreground)]',
            'focus:outline-none',
            'disabled:cursor-not-allowed',
          )}
        />
      </div>

      {isOpen && availableOptions.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className={cn(
            'absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border',
            'border-[var(--border)] bg-[var(--popover)] text-[var(--popover-foreground)]',
            'shadow-md',
          )}
        >
          {availableOptions.map((option, index) => (
            <li
              key={option.value}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={false}
              aria-disabled={option.disabled}
              onMouseDown={(e) => {
                e.preventDefault()
                if (!option.disabled) handleAdd(option.value)
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={cn(
                'cursor-pointer px-3 py-2 text-sm',
                index === highlightedIndex &&
                  'bg-[var(--accent)] text-[var(--accent-foreground)]',
                option.disabled &&
                  'cursor-not-allowed opacity-50',
              )}
            >
              <div className="flex items-center justify-between">
                <span>{option.label}</span>
                {option.badge && (
                  <span
                    className={cn(
                      'ml-2 rounded-full px-2 py-0.5 text-xs',
                      'bg-[var(--secondary)] text-[var(--secondary-foreground)]',
                    )}
                  >
                    {option.badge}
                  </span>
                )}
              </div>
              {option.description && (
                <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                  {option.description}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
