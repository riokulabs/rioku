#!/usr/bin/env node
// Prepend `// @ts-nocheck` to every generated *.ts file under
// packages/web/src/api/generated/. The Orval emitter doesn't honor
// our strict tsconfig (exactOptionalPropertyTypes, noUncheckedIndexedAccess);
// suppressing typecheck on auto-generated infrastructure is the standard
// remedy. Type information still flows to consumers via TS resolution.

import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('../src/api/generated/', import.meta.url);
const HEADER = '// @ts-nocheck\n';

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile() && (p.endsWith('.ts') || p.endsWith('.tsx'))) yield p;
  }
}

let n = 0;
for await (const file of walk(ROOT.pathname)) {
  const buf = await readFile(file, 'utf8');
  if (buf.startsWith(HEADER)) continue;
  await writeFile(file, HEADER + buf);
  n++;
}
console.log(`suppress-generated-typecheck: prepended @ts-nocheck to ${n} generated files`);
