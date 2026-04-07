import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useHotkeyRegistry, getModLabel } from '@/hooks/use-hotkeys'

interface KeyboardShortcutHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/** Render a hotkey combo as user-facing text. */
function formatKey(raw: string): string {
  const mod = getModLabel()
  return raw
    .split('+')
    .map((part) => {
      const lower = part.toLowerCase()
      if (lower === 'mod') return mod
      if (lower === 'shift') return 'Shift'
      if (lower === 'alt') return 'Alt'
      if (lower === 'ctrl') return 'Ctrl'
      // Capitalise single keys
      return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' + ')
}

function KeyboardShortcutHelp({ open, onOpenChange }: KeyboardShortcutHelpProps) {
  const shortcuts = useHotkeyRegistry()

  // Group by scope
  const grouped: Record<string, { key: string; scope: string }[]> = {}
  for (const s of shortcuts) {
    const scope = s.scope || 'global'
    if (!grouped[scope]) grouped[scope] = []
    grouped[scope].push(s)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard Shortcuts</DialogTitle>
          <DialogDescription>All registered keyboard shortcuts</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {Object.entries(grouped).map(([scope, items]) => (
            <div key={scope}>
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {scope}
              </h3>
              <div className="space-y-1">
                {items.map((shortcut) => (
                  <div
                    key={`${shortcut.scope}-${shortcut.key}`}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-sm"
                  >
                    <span className="text-muted-foreground">{shortcut.key}</span>
                    <kbd className="inline-flex h-5 items-center rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
                      {formatKey(shortcut.key)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {shortcuts.length === 0 && (
            <p className="text-sm text-muted-foreground">No shortcuts registered.</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { KeyboardShortcutHelp }
