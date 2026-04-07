import { useState, useCallback } from 'react'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface CodeBlockProps {
  value: string | object
  language?: string
  copyable?: boolean
  maxHeight?: string
  className?: string
}

function CodeBlock({
  value,
  language = 'json',
  copyable = true,
  maxHeight,
  className,
}: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const text =
    typeof value === 'string' ? value : JSON.stringify(value, null, 2)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [text])

  return (
    <div
      className={cn(
        'relative rounded-lg border bg-zinc-950 text-zinc-100 dark:border-zinc-800',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
          {language}
        </span>
        {copyable && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
            onClick={handleCopy}
          >
            {copied ? (
              <CheckIcon className="size-3" />
            ) : (
              <CopyIcon className="size-3" />
            )}
            <span className="sr-only">Copy</span>
          </Button>
        )}
      </div>
      <pre
        className="overflow-auto p-3 text-xs leading-relaxed"
        style={maxHeight ? { maxHeight } : undefined}
      >
        <code>{text}</code>
      </pre>
    </div>
  )
}

export { CodeBlock }
export type { CodeBlockProps }
