#!/usr/bin/env node
// CI gate: fail if any chunk exceeds its hard cap in spec §13.6.
// Chunk matching uses substring search against Vite output filenames.
// Vite produces: index-[hash].js (main), mantine-core-[hash].js, etc.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';

const DIST = join(process.cwd(), 'dist/assets');
const BUDGETS_KB = {
  // main entry chunk — Vite may name it "index" or "main"
  main: { target: 800, hard: 1000, aliases: ['index', 'main'] },
  'mantine-core': { target: 400, hard: 600, aliases: ['mantine-core', 'mantine'] },
  tanstack: { target: 200, hard: 300, aliases: ['tanstack'] },
  scalar: { target: 300, hard: 500, aliases: ['scalar'] },
  monaco: { target: 500, hard: 700, aliases: ['monaco'] },
  shiki: { target: 250, hard: 400, aliases: ['shiki'] },
  tiptap: { target: 400, hard: 600, aliases: ['tiptap'] },
  cel: { target: 80, hard: 120, aliases: ['cel'] },
  'total-gzipped': { target: 4000, hard: 6000, aliases: [] },
};

let files;
try {
  files = readdirSync(DIST).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`\n✘ dist/assets/ not found — run "npm run build" first`);
  process.exit(1);
}

let totalGz = 0;
const failures = [];
const warnings = [];
const matched = new Set();

for (const [chunk, { target, hard, aliases }] of Object.entries(BUDGETS_KB)) {
  if (chunk === 'total-gzipped') continue;
  const searchTerms = aliases.length > 0 ? aliases : [chunk];
  const match = files.find((f) => searchTerms.some((term) => f.includes(term)));
  if (!match) {
    // Not every chunk will be present in every build (e.g. monaco, scalar are lazy-loaded)
    continue;
  }
  if (matched.has(match)) continue;
  matched.add(match);

  const filePath = join(DIST, match);
  const buf = readFileSync(filePath);
  const gzKb = gzipSync(buf).length / 1024;
  totalGz += gzKb;

  if (gzKb > hard) {
    failures.push(`${chunk} (${match}): ${gzKb.toFixed(1)} KB gzipped (hard cap ${hard} KB)`);
  } else if (gzKb > target) {
    warnings.push(`${chunk} (${match}): ${gzKb.toFixed(1)} KB gzipped (target ${target} KB)`);
  } else {
    console.log(`  ✓ ${chunk} (${match}): ${gzKb.toFixed(1)} KB gzipped`);
  }
}

// Add unmatched JS chunks to total
for (const f of files) {
  if (!matched.has(f)) {
    const buf = readFileSync(join(DIST, f));
    totalGz += gzipSync(buf).length / 1024;
  }
}

const totalHard = BUDGETS_KB['total-gzipped'].hard;
const totalTarget = BUDGETS_KB['total-gzipped'].target;

console.log(`\nTotal gzipped (all JS): ${totalGz.toFixed(1)} KB`);

if (totalGz > totalHard) {
  failures.push(`total: ${totalGz.toFixed(1)} KB gzipped (hard cap ${totalHard} KB)`);
} else if (totalGz > totalTarget) {
  warnings.push(`total: ${totalGz.toFixed(1)} KB gzipped (target ${totalTarget} KB)`);
}

if (warnings.length) {
  console.warn('\n⚠ Budget warnings:\n' + warnings.map((w) => '  ' + w).join('\n'));
}
if (failures.length) {
  console.error('\n✘ Budget failures:\n' + failures.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('\n✓ All chunks within budgets');
