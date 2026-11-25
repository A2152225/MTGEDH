#!/usr/bin/env node
/**
 * Equivalent of the eslint no-restricted-syntax rule in eslint.config.js
 * that bans require() / createRequire() in the ESM packages. Runs without
 * an eslint install: `npm run lint:require`.
 *
 * Scans server, rules-engine, and shared (src + server/scripts). Skips
 * comments, strings, and *.cjs files.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const ROOTS = [
  path.join(ROOT, 'server', 'src'),
  path.join(ROOT, 'server', 'scripts'),
  path.join(ROOT, 'rules-engine', 'src'),
  path.join(ROOT, 'shared', 'src'),
];

function walk(dir, acc) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx|js|mjs)$/.test(entry.name) && !entry.name.endsWith('.cjs')) acc.push(full);
  }
  return acc;
}

function isIdentChar(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function skipString(src, i) {
  const q = src[i];
  i += 1;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { i += 2; continue; }
    if (c === q) return i + 1;
    if (q === '`' && c === '$' && src[i + 1] === '{') {
      i += 2;
      let depth = 1;
      while (i < src.length && depth > 0) {
        const inner = src[i];
        if (inner === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
        if (inner === '/' && src[i + 1] === '*') {
          const end = src.indexOf('*/', i + 2);
          i = end < 0 ? src.length : end + 2;
          continue;
        }
        if (inner === '"' || inner === "'" || inner === '`') { i = skipString(src, i); continue; }
        if (inner === '{') { depth += 1; i += 1; continue; }
        if (inner === '}') {
          depth -= 1;
          i += 1;
          if (depth === 0) break;
          continue;
        }
        i += 1;
      }
      continue;
    }
    i += 1;
  }
  return i;
}

function lineOf(src, idx) {
  let n = 1;
  for (let i = 0; i < idx; i++) if (src[i] === '\n') n += 1;
  return n;
}

function findHits(src) {
  const hits = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { i = skipString(src, i); continue; }

    if (src.startsWith('require', i) && !isIdentChar(src[i - 1] || '') && !isIdentChar(src[i + 7] || '')) {
      let j = i + 7;
      while (/\s/.test(src[j])) j += 1;
      if (src[j] === '(') {
        hits.push({ kind: 'require()', index: i, line: lineOf(src, i) });
        i = j + 1;
        continue;
      }
    }
    if (src.startsWith('createRequire', i) && !isIdentChar(src[i - 1] || '') && !isIdentChar(src[i + 13] || '')) {
      let j = i + 13;
      while (/\s/.test(src[j])) j += 1;
      if (src[j] === '(') {
        hits.push({ kind: 'createRequire()', index: i, line: lineOf(src, i) });
        i = j + 1;
        continue;
      }
    }
    i += 1;
  }
  return hits;
}

const files = ROOTS.flatMap((dir) => walk(dir, []));
files.sort();
const allHits = [];
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const hits = findHits(src);
  for (const hit of hits) {
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    allHits.push({ file: rel, line: hit.line, kind: hit.kind });
  }
}

if (allHits.length === 0) {
  console.log('lint:require: no require() / createRequire() hits in server, rules-engine, or shared ESM sources.');
  process.exit(0);
}

console.error(`lint:require: ${allHits.length} forbidden CommonJS require hit(s):`);
for (const hit of allHits) {
  console.error(`  ${hit.file}:${hit.line}  ${hit.kind}`);
}
console.error('Use a static import instead (or import() only for a real cycle).');
process.exit(1);
