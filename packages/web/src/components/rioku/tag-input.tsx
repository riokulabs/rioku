import { useState, type KeyboardEvent } from 'react'
import { XIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'

interface TagInputProps {
  value: string[]
  onChange: (value: string[]) => void
  label: string
  placeholder?: string
  disabled?: boolean
  className?: string
}

function TagInput({
  value,
  onChange,
  label,
  placeholder = 'Type and press Enter...',
  disabled = false,
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState('')

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const trimmed = inputValue.trim()
      if (trimmed && !value.includes(trimmed)) {
        onChange([...value, trimmed])
        setInputValue('')
      }
    }
  }

  const handleRemove = (tag: string) => {
    onChange(value.filter((t) => t !== tag))
  }

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {value.map((tag) => (
          <Badge
            key={tag}
            variant="secondary"
            className="gap-1 pr-1"
          >
            <span className="font-mono text-xs">{tag}</span>
            {!disabled && (
              <button
                type="button"
                onClick={() => handleRemove(tag)}
                className="ml-0.5 rounded-sm hover:bg-muted-foreground/20 p-0.5"
                aria-label={`Remove ${tag}`}
              >
                <XIcon className="size-3" />
              </button>
            )}
          </Badge>
        ))}
      </div>
      <Input
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
      />
    </div>
  )
}

export { TagInput }
export type { TagInputProps }
