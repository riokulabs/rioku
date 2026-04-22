# `<ConditionEditor>`

Monaco-backed CEL (Common Expression Language) expression editor for Rioku Admin.

## Props

| Prop               | Type                    | Default  | Description                                   |
| ------------------ | ----------------------- | -------- | --------------------------------------------- |
| `value`            | `string`                | required | Current CEL expression                        |
| `onChange`         | `(v: string) => void`   | required | Called on every keystroke                     |
| `onValidityChange` | `(ok: boolean) => void` | —        | Called after 250ms debounce with parse result |
| `label`            | `string`                | —        | Optional label rendered above chrome text     |
| `placeholder`      | `string`                | —        | Monaco placeholder text                       |
| `readOnly`         | `boolean`               | `false`  | Disables editing                              |
| `height`           | `number`                | `160`    | Editor height in pixels                       |

## Behaviour

- 250ms debounce on `onChange` → `parseCel()` from `src/lib/cel-parser.ts`
- Parse errors are shown as inline Monaco markers (red squiggles + gutter icon)
- Chrome text per spec §7.2: _"Syntax check by cel-js; the daemon is authoritative. Save to trigger full validation."_
- CEL language registration (`cel-language.ts`) is guarded by a module-level flag — safe to mount multiple editors.

## Testing

Monaco is mocked in tests with a trivial `<textarea>` stub. The mock exercises debounce logic, parseCel dispatch, onValidityChange callbacks, and accessibility. Monaco widget rendering and marker gutter are covered by Playwright E2E tests (Batch D4).
