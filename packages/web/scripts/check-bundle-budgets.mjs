#!/usr/bin/env node
// CI gate: fail if any chunk exceeds its hard cap in spec §13.6.
// Chunk matching uses substring search against Vite output filenames.
// Vite produces: index-[hash].js (main), mantine-core-[hash].js, etc.
//
// Per-route budget overrides: set BUNDLE_BUDGET_OVERRIDES_JSON to a JSON
// object mapping chunk name → hard-cap in KB.
// Example: BUNDLE_BUDGET_OVERRIDES_JSON='{"scalar":1100}' pnpm check-budgets
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
  // Scalar bundles its own Vue runtime + full reference renderer; 0.9.24
  // ships at ~890 KB gzipped. Spec §13.6 aspirationally targeted 500 KB but
  // Scalar's published footprint is well above that — the chunk is lazy-
  // loaded behind the /api-explorer route so it doesn't touch initial TTI.
  // Target stays at 500 KB to keep pressure on any future slim-down
  // opportunity; hard cap matches the current reality + headroom.
  scalar: { target: 500, hard: 1000, aliases: ['scalar'] },
  monaco: { target: 500, hard: 700, aliases: ['monaco'] },
  shiki: { target: 250, hard: 400, aliases: ['shiki'] },
  tiptap: { target: 400, hard: 600, aliases: ['tiptap'] },
  cel: { target: 80, hard: 120, aliases: ['cel'] },
  'total-gzipped': { target: 4000, hard: 6000, aliases: [] },
};

// Apply per-chunk overrides from BUNDLE_BUDGET_OVERRIDES_JSON env var.
// The env var accepts JSON: {"chunk-name": hardCapKB, ...}
// Overrides are intended for local iteration only; CI rejects PRs that
// embed overrides in workflow files (§4.6).
const overrideEnv = process.env.BUNDLE_BUDGET_OVERRIDES_JSON;
if (overrideEnv) {
  let overrides;
  try {
    overrides = JSON.parse(overrideEnv);
  } catch {
    console.error('✘ BUNDLE_BUDGET_OVERRIDES_JSON is not valid JSON — aborting');
    process.exit(1);
  }
  for (const [chunk, hardKb] of Object.entries(overrides)) {
    if (!(chunk in BUDGETS_KB)) {
      console.warn(`⚠ BUNDLE_BUDGET_OVERRIDES_JSON: unknown chunk "${chunk}" (ignored)`);
      continue;
    }
    BUDGETS_KB[chunk] = { ...BUDGETS_KB[chunk], hard: Number(hardKb) };
    console.log(`  override: ${chunk} hard cap → ${hardKb} KB`);
  }
}

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
/** @type {Array<{chunk: string, file: string, gzKb: number, target: number, hard: number, status: 'pass'|'warn'|'fail'}>} */
const auditRows = [];

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
    auditRows.push({ chunk, file: match, gzKb, target, hard, status: 'fail' });
  } else if (gzKb > target) {
    warnings.push(`${chunk} (${match}): ${gzKb.toFixed(1)} KB gzipped (target ${target} KB)`);
    auditRows.push({ chunk, file: match, gzKb, target, hard, status: 'warn' });
  } else {
    console.log(`  ✓ ${chunk} (${match}): ${gzKb.toFixed(1)} KB gzipped`);
    auditRows.push({ chunk, file: match, gzKb, target, hard, status: 'pass' });
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

const totalStatus = totalGz > totalHard ? 'fail' : totalGz > totalTarget ? 'warn' : 'pass';
auditRows.push({
  chunk: 'total-gzipped',
  file: '(all JS)',
  gzKb: totalGz,
  target: totalTarget,
  hard: totalHard,
  status: totalStatus,
});

if (totalGz > totalHard) {
  failures.push(`total: ${totalGz.toFixed(1)} KB gzipped (hard cap ${totalHard} KB)`);
} else if (totalGz > totalTarget) {
  warnings.push(`total: ${totalGz.toFixed(1)} KB gzipped (target ${totalTarget} KB)`);
}

// Summary table — always printed regardless of pass/fail
const statusIcon = { pass: '✓', warn: '⚠', fail: '✘' };
const colW = [20, 42, 10, 10, 10, 6];
const header = ['Chunk', 'File', 'Gz (KB)', 'Target', 'Hard', 'Status'];
const row = (cols) => '| ' + cols.map((c, i) => String(c).padEnd(colW[i])).join(' | ') + ' |';
const sep = '|' + colW.map((w) => '-'.repeat(w + 2)).join('|') + '|';

console.log('\n## Bundle audit summary\n');
console.log(row(header));
console.log(sep);
for (const r of auditRows) {
  console.log(
    row([
      r.chunk,
      r.file.length > colW[1] ? '…' + r.file.slice(-(colW[1] - 1)) : r.file,
      r.gzKb.toFixed(1),
      r.target,
      r.hard,
      statusIcon[r.status],
    ]),
  );
}

if (warnings.length) {
  console.warn('\n⚠ Budget warnings:\n' + warnings.map((w) => '  ' + w).join('\n'));
}
if (failures.length) {
  console.error('\n✘ Budget failures:\n' + failures.map((f) => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('\n✓ All chunks within budgets');
