import { useCallback, useId, useRef } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@ui/lib/utils'

/** Props for the Checkbox component. */
export interface CheckboxProps {
  /** Whether the checkbox is checked, unchecked, or in an indeterminate state */
  checked: boolean | 'indeterminate'
  /** Called when the checked state changes */
  onChange: (checked: boolean) => void
  /** Whether the checkbox is disabled */
  disabled?: boolean
  /** Additional CSS class names */
  className?: string
  /** Accessible label for the checkbox */
  'aria-label'?: string
}

/**
 * A themed checkbox component with support for checked, unchecked,
 * and indeterminate states.
 *
 * Uses a hidden native input for accessibility and a styled visual overlay.
 * Supports keyboard interaction (Space to toggle) and focus-visible styling.
 */
export function Checkbox({
  checked,
  onChange,
  disabled = false,
  className,
  'aria-label': ariaLabel,
}: CheckboxProps) {
  const id = useId()
  const inputRef = useRef<HTMLInputElement>(null)

  const isChecked = checked === true
  const isIndeterminate = checked === 'indeterminate'

  const handleChange = useCallback(() => {
    if (disabled) return
    // Checked -> unchecked; unchecked or indeterminate -> checked
    onChange(isIndeterminate ? true : !isChecked)
  }, [disabled, isChecked, isIndeterminate, onChange])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault()
        handleChange()
      }
    },
    [handleChange],
  )

  return (
    <span
      className={cn('relative inline-flex items-center justify-center', className)}
    >
      {/* Hidden native input for form participation (not the a11y target) */}
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        checked={isChecked}
        disabled={disabled}
        onChange={handleChange}
        aria-hidden="true"
        className="sr-only peer"
        tabIndex={-1}
      />

      {/* Visual checkbox */}
      <span
        role="checkbox"
        aria-checked={isIndeterminate ? 'mixed' : isChecked}
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onClick={handleChange}
        className={cn(
          'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] border transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2',
          isChecked || isIndeterminate
            ? 'border-[var(--primary)] bg-[var(--primary)] text-white'
            : 'border-[var(--border)] bg-[var(--input)]',
          disabled && 'cursor-not-allowed opacity-50',
          !disabled && 'cursor-pointer',
        )}
      >
        {isChecked && <Check className="h-3 w-3" strokeWidth={3} />}
        {isIndeterminate && <Minus className="h-3 w-3" strokeWidth={3} />}
      </span>
    </span>
  )
}
