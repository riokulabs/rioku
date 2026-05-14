#!/usr/bin/env node
// Validate every fenced ```mermaid block under docs/ and contrib-docs/.
//
// Each block is written to a temp file and parsed via @mermaid-js/mermaid-cli
// in "parse" mode (no PNG/SVG render, no Puppeteer required when --quiet
// + a fake output file are used). Exit non-zero if any block fails.
//
// Usage: node scripts/validate-mermaid.mjs [path ...]
//        Defaults to docs/docs and contrib-docs/docs when no args given.

import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const ROOTS = process.argv.slice(2);
if (ROOTS.length === 0) ROOTS.push('docs/docs', 'contrib-docs/docs');

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (entry === 'node_modules' || entry === 'build' || entry === '.docusaurus') continue;
      walk(p, out);
    } else if (s.isFile() && (p.endsWith('.md') || p.endsWith('.mdx'))) {
      out.push(p);
    }
  }
  return out;
}

function extractBlocks(content, path) {
  const blocks = [];
  const lines = content.split('\n');
  let inBlock = false;
  let start = 0;
  let buf = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!inBlock && /^```mermaid\s*$/.test(line)) {
      inBlock = true;
      start = i + 2; // 1-based line of first content line
      buf = [];
      continue;
    }
    if (inBlock && /^```\s*$/.test(line)) {
      blocks.push({ path, startLine: start, code: buf.join('\n') });
      inBlock = false;
      continue;
    }
    if (inBlock) buf.push(line);
  }
  return blocks;
}

function validateBlock(block, tmp, puppeteerCfg) {
  const inPath = join(tmp, 'block.mmd');
  const outPath = join(tmp, 'block.svg');
  writeFileSync(inPath, block.code);
  const r = spawnSync('npx', ['--no-install', '-p', '@mermaid-js/mermaid-cli', 'mmdc', '-i', inPath, '-o', outPath, '-q', '--puppeteerConfigFile', puppeteerCfg], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (r.status === 0) return null;
  return (r.stderr || r.stdout || 'unknown mermaid error').trim();
}

const files = ROOTS.flatMap((root) => {
  try { return walk(root); } catch { return []; }
});

const blocks = files.flatMap((f) => extractBlocks(readFileSync(f, 'utf8'), f));
if (blocks.length === 0) {
  console.log('No mermaid blocks found.');
  process.exit(0);
}

console.log(`Validating ${blocks.length} mermaid block(s) in ${files.length} file(s)...`);

const tmp = mkdtempSync(join(tmpdir(), 'mermaid-validate-'));
// Puppeteer launches Chromium with the sandbox enabled by default. CI
// runners (GitHub Actions, plain containers) lack the kernel capabilities
// Chromium needs to set up the sandbox, so the browser process exits
// immediately with "No usable sandbox!". Disabling the sandbox at launch
// time is the standard CI workaround.
const puppeteerCfg = join(tmp, 'puppeteer.json');
writeFileSync(puppeteerCfg, JSON.stringify({ args: ['--no-sandbox', '--disable-setuid-sandbox'] }));
let failed = 0;
try {
  for (const block of blocks) {
    const err = validateBlock(block, tmp, puppeteerCfg);
    const loc = `${relative(process.cwd(), block.path)}:${block.startLine}`;
    if (err) {
      failed++;
      console.error(`\n[FAIL] ${loc}`);
      console.error(err.split('\n').map((l) => '  ' + l).join('\n'));
    } else {
      console.log(`[ok]   ${loc}`);
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} mermaid block(s) failed to parse.`);
  process.exit(1);
}
console.log(`\nAll ${blocks.length} mermaid block(s) parse successfully.`);
