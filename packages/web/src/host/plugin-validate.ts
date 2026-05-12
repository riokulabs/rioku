/**
 * Plugin bundle static scanner.
 * Scans the text of a compiled plugin ESM bundle looking for forbidden patterns:
 *   1. Bundled copies of externalized deps (react, @mantine/*, @tanstack/*, etc.)
 *   2. Object.prototype pollution patterns
 *   3. eval / new Function() usage
 *
 * Used by:
 *   - `rioku plugin validate` CLI (stub)
 *   - In-app install-time scanner (before showing the approval UI)
 *
 * Current approach: text-based heuristic scan.
 * AST-based scan is a planned enhancement.
 *
 * Heuristic design notes:
 *   - A properly externalized dependency appears in the bundle only as an
 *     import statement: `import React from 'react'` or `import{...}from'react'`.
 *     These are at the top of the file and reference the package by name.
 *   - A BUNDLED copy of the same library produces internal variable assignments
 *     (e.g. `var _react = ...`, `var $jsxRuntime = ...`) and distinctive class
 *     strings or runtime markers that only appear when the library is inlined.
 *   - We look for these bundler-produced assignment patterns rather than for
 *     the import statement (which would false-positive on correct externals).
 *
 * LIMITATIONS:
 *   - Some false positives are possible for bundles that comment out imports
 *     or have unusual minifier output.
 *   - Obfuscated bundles may evade detection.
 *   - The heuristic is not exhaustive — AST analysis is the long-term answer.
 */

import { REQUIRED_EXTERNALS } from './plugin-externals';

// ─── Result type ──────────────────────────────────────────────────────────────

export interface BundleScanResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

// ─── Heuristic fingerprints ───────────────────────────────────────────────────

/**
 * Strings that reliably appear in bundled (inlined) copies of each library,
 * but NOT in properly externalized imports.
 *
 * Each entry: [packageName, pattern] where pattern is searched as a plain
 * substring in the bundle text.
 *
 * Rationale per package:
 *   - react: bundled copy includes the internal scheduler integration marker.
 *   - react-dom/client: bundled when react-dom is inlined; this string only
 *     appears in bundled ReactDOM.
 *   - @mantine/core: mantine injects this focus-handling class string at init.
 *   - @tanstack/react-query: bundled copy includes the `QueryClientContext`
 *     string as part of its context initialisation — external copies reference
 *     it via a closure but don't produce this assignment.
 *   - @tanstack/react-router: RouterContext string is an internal symbol.
 *   - @tabler/icons-react: bundled Tabler creates SVG path constants starting
 *     with this prefix.
 *   - zod: bundled zod includes the `ZodType` constructor name.
 *   - recharts: bundled recharts exports `CartesianAxis` as a named var.
 *   - @rioku/plugin-sdk: must NEVER appear bundled — plugins must import it as
 *     an external. This string appearing in a bundle (outside an import) is a
 *     sign the SDK was inlined.
 */
const FINGERPRINTS: { pkg: string; pattern: string; description: string }[] = [
  {
    pkg: 'react',
    pattern: '__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED',
    description: 'React internal marker (only present in bundled React)',
  },
  {
    pkg: 'react-dom',
    pattern: 'react-dom/client',
    description: 'react-dom/client sub-entry (only present when react-dom is bundled)',
  },
  {
    pkg: '@mantine/core',
    pattern: 'mantine-focus-auto',
    description: 'Mantine focus-ring class (only present when @mantine/core is bundled)',
  },
  {
    pkg: '@tanstack/react-query',
    pattern: 'QueryClientContext',
    description: 'TanStack Query context symbol (only present when bundled)',
  },
  {
    pkg: '@tanstack/react-router',
    pattern: 'RouterContext',
    description: 'TanStack Router context symbol (only present when bundled)',
  },
  {
    pkg: '@tabler/icons-react',
    pattern: 'createReactComponent',
    description: 'Tabler icon factory (only present when @tabler/icons-react is bundled)',
  },
  {
    pkg: 'zod',
    pattern: 'ZodFirstPartyTypeKind',
    description: 'Zod internal enum (only present when zod is bundled)',
  },
  {
    pkg: 'recharts',
    pattern: 'CartesianAxis',
    description: 'Recharts CartesianAxis (only present when recharts is bundled)',
  },
  {
    pkg: '@rioku/plugin-sdk',
    pattern: '@rioku/plugin-sdk',
    description: '@rioku/plugin-sdk must always be external — never bundled',
  },
];

// ─── Pollution + dangerous patterns ──────────────────────────────────────────

const POLLUTION_PATTERNS: { pattern: string; description: string }[] = [
  {
    pattern: 'Object.prototype.',
    description:
      'Object.prototype mutation — potential prototype pollution (the plugin spec freeze rule)',
  },
  {
    pattern: '__proto__',
    description: '__proto__ assignment — prototype pollution vector',
  },
];

const DANGEROUS_PATTERNS: { pattern: string; description: string }[] = [
  {
    pattern: 'eval(',
    description: 'eval() usage — forbidden by the plugin spec',
  },
  {
    pattern: 'new Function(',
    description: 'new Function() usage — forbidden by the plugin spec',
  },
];

// ─── Helper: detect if pattern is inside an ESM import statement ──────────────

/**
 * Returns true if the given pattern occurrence in `text` at offset `idx` is
 * part of a `from '...'` or `import '...'` ESM statement (i.e., a legitimate
 * external reference, not a bundled copy).
 *
 * Heuristic: look backwards from `idx` for the word `from` or `import` within
 * 80 characters (covers typical import line lengths after minification).
 */
function isInsideImportStatement(text: string, idx: number): boolean {
  const lookback = Math.max(0, idx - 80);
  // Slice up to (but not including) the match start — we want to check what
  // precedes the pattern, so the slice should end just before idx.
  const slice = text.slice(lookback, idx);
  return /\bfrom\s*['"]$/.test(slice) || /\bimport\s*['"]$/.test(slice);
}

// ─── Main scanner ─────────────────────────────────────────────────────────────

/**
 * Scan a compiled plugin ESM bundle text for forbidden patterns.
 *
 * @param bundleText - The full text content of the compiled plugin .mjs file.
 * @returns `BundleScanResult` with `ok: false` if any errors were found.
 */
export function scanPluginBundle(bundleText: string): BundleScanResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── 1. Check for bundled externals ─────────────────────────────────────────
  for (const { pkg, pattern, description } of FINGERPRINTS) {
    const idx = bundleText.indexOf(pattern);
    if (idx !== -1 && !isInsideImportStatement(bundleText, idx)) {
      errors.push(
        `"${pkg}" appears to be bundled (found "${pattern}"): ${description}. ` +
          `Add "${pkg}" to your Vite config's external[] list.`,
      );
    }
  }

  // ── 2. Check for Object.prototype pollution ─────────────────────────────────
  for (const { pattern, description } of POLLUTION_PATTERNS) {
    // Object.prototype. is common in minified code for legitimate reads
    // (e.g. Object.prototype.hasOwnProperty). We flag writes only.
    // A write looks like: Object.prototype.X = ... or Object.prototype[...] =
    // Simple heuristic: flag as a warning (not an error) unless there is an
    // assignment operator within 30 chars.
    let searchStart = 0;
    let found = false;
    while ((searchStart = bundleText.indexOf(pattern, searchStart)) !== -1) {
      const after = bundleText.slice(
        searchStart + pattern.length,
        searchStart + pattern.length + 50,
      );
      if (/\s*=\s*(?!=)/.test(after)) {
        // Looks like an assignment
        found = true;
        break;
      }
      searchStart += pattern.length;
    }
    if (found) {
      warnings.push(`Potential prototype pollution: ${description}`);
    }
  }

  // ── 3. Check for dangerous patterns (eval, new Function) ────────────────────
  for (const { pattern, description } of DANGEROUS_PATTERNS) {
    if (bundleText.includes(pattern)) {
      errors.push(`Forbidden pattern "${pattern}": ${description}`);
    }
  }

  // ── 4. Verify at least one required external is actually imported ────────────
  // If a bundle imports NONE of the required externals, that is suspicious —
  // perhaps the plugin doesn't use React at all, or all dependencies are
  // bundled. Issue a warning.
  const hasAnyExternalImport = REQUIRED_EXTERNALS.some((ext) => {
    const importPattern = `'${ext}'`;
    const importPatternDq = `"${ext}"`;
    return bundleText.includes(importPattern) || bundleText.includes(importPatternDq);
  });

  if (!hasAnyExternalImport && bundleText.length > 500) {
    warnings.push(
      'Bundle contains no imports from the required externals list. ' +
        'If this plugin uses React/Mantine/etc., ensure they are externalized.',
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  };
}
