# `<KeyboardShortcutsHelp>`

A modal overlay listing all global keyboard shortcuts, toggled by pressing `?`.

## What it is

- Mounts a Mantine `<Modal>` that is hidden by default.
- Listens for the `?` global hotkey via `useHotkeys` from `@mantine/hooks`.
- `useHotkeys` automatically ignores the shortcut when the user is focused on an `<input>`, `<textarea>`, or `<select>`.
- Displays a two-column `<Table>` of shortcuts: Keys (rendered with `<Kbd>`) | Action description.
- Stage-1 shortcuts are static. Plugin-contributed shortcuts will be added in Phase 1f.
- Mount once per active layout (`AppLayout` or `AdminLayout`) — only one layout is active at any time, so there is no double-listener risk.

## What it is not for

- It is not a command palette — use the Spotlight component (`⌘K`) for that.
- It is not a settings panel — shortcuts are read-only here.
- Do not render it more than once simultaneously (each instance installs its own hotkey listener).
