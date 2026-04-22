# `<CodeBlock>`

Shiki-backed syntax highlighter. Lazy-loads shiki on first mount (lands in the dedicated `shiki` Rollup chunk).

## Props

| Prop        | Type                | Default  | Description                       |
| ----------- | ------------------- | -------- | --------------------------------- |
| `code`      | `string`            | required | Source string to highlight        |
| `language`  | `SupportedLanguage` | `'text'` | Grammar to use                    |
| `title`     | `string`            | —        | Optional header label             |
| `copyable`  | `boolean`           | `true`   | Show copy-to-clipboard button     |
| `maxHeight` | `number`            | —        | Max height in px before scrolling |

## Supported languages

`json`, `yaml`, `typescript`, `javascript`, `bash`, `text` (falls back to `bash` grammar for plain text)

## Themes

- Dark mode → `vitesse-dark`
- Light mode → `vitesse-light`

Picked automatically from Mantine's current color scheme.

## Usage

```tsx
import { CodeBlock } from '@/components/code-block';

<CodeBlock
  code={JSON.stringify(payload, null, 2)}
  language="json"
  title="payload.json"
  maxHeight={400}
/>;
```
