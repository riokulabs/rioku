import { useState, useEffect } from 'react'
import { LoaderIcon } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface TypedConfirmationDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmPhrase: string
  confirmLabel?: string
  onConfirm: () => void
  loading?: boolean
}

function TypedConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmPhrase,
  confirmLabel = 'Confirm',
  onConfirm,
  loading = false,
}: TypedConfirmationDialogProps) {
  const [typed, setTyped] = useState('')
  const matches = typed === confirmPhrase

  useEffect(() => {
    if (open) setTyped('')
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Label>
            Type{' '}
            <span className="font-mono font-semibold text-destructive">
              {confirmPhrase}
            </span>{' '}
            to confirm
          </Label>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={confirmPhrase}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!matches || loading}
          >
            {loading && <LoaderIcon className="size-4 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TypedConfirmationDialog }
export type { TypedConfirmationDialogProps }
