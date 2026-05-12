/**
 * Monaco CEL language registration helper.
 *
 * Registers a minimal 'cel' language with syntax highlighting for:
 *   - Keywords: in, has, timestamp, duration, now, true, false, null
 *   - Operators: ==, !=, <, >, <=, >=, &&, ||, !
 *   - Number and string literals
 *
 * Uses a module-level guard to prevent double-registration (Monaco's
 * language registry is global — re-registering emits warnings).
 */

import type * as MonacoNS from 'monaco-editor';

let _registered = false;

export function registerCelLanguage(monaco: typeof MonacoNS): void {
  if (_registered) return;
  _registered = true;

  monaco.languages.register({ id: 'cel' });

  monaco.languages.setMonarchTokensProvider('cel', {
    keywords: ['in', 'has', 'timestamp', 'duration', 'now', 'true', 'false', 'null'],

    operators: ['==', '!=', '<', '>', '<=', '>=', '&&', '||', '!'],

    tokenizer: {
      root: [
        // Identifiers and keywords
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],

        // Whitespace
        [/\s+/, 'white'],

        // String literals (double-quoted)
        [/"/, 'string', '@string_double'],

        // String literals (single-quoted)
        [/'/, 'string', '@string_single'],

        // Numbers (integer + float)
        [/\d+\.\d*([eE][+-]?\d+)?/, 'number.float'],
        [/\d+[eE][+-]?\d+/, 'number.float'],
        [/0x[\da-fA-F]+/, 'number.hex'],
        [/\d+/, 'number'],

        // Operators
        [/[=!<>]=?/, 'operator'],
        [/&&|\|\||!/, 'operator'],

        // Delimiters

        [/[{}()[\]]/, '@brackets'],
        [/[.,;]/, 'delimiter'],
      ],

      string_double: [
        [/[^"\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/"/, 'string', '@pop'],
      ],

      string_single: [
        [/[^'\\]+/, 'string'],
        [/\\./, 'string.escape'],
        [/'/, 'string', '@pop'],
      ],
    },
  });

  monaco.languages.setLanguageConfiguration('cel', {
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"', notIn: ['string'] },
      { open: "'", close: "'", notIn: ['string'] },
    ],
  });
}
