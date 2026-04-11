import { CheckIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface WizardStepIndicatorProps {
  steps: string[]
  currentStep: number
  className?: string
}

function WizardStepIndicator({ steps, currentStep, className }: WizardStepIndicatorProps) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {steps.map((label, i) => {
        const isDone = i < currentStep
        const isActive = i === currentStep
        const isPending = i > currentStep
        return (
          <div key={label} className="flex items-center gap-2">
            <div className="flex items-center gap-2">
              <div
                data-step-done={isDone || undefined}
                data-step-active={isActive || undefined}
                data-step-pending={isPending || undefined}
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs font-bold',
                  isDone && 'bg-green-600 text-white',
                  isActive && 'bg-primary text-primary-foreground',
                  isPending && 'bg-muted text-muted-foreground',
                )}
              >
                {isDone ? <CheckIcon className="size-3.5" /> : i + 1}
              </div>
              <span
                className={cn(
                  'text-sm font-medium',
                  isDone && 'text-green-600',
                  isActive && 'text-primary',
                  isPending && 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className={cn('h-px w-12', isDone ? 'bg-green-600' : 'bg-border')} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export { WizardStepIndicator }
export type { WizardStepIndicatorProps }
