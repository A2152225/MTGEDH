#!/usr/bin/env node
import fs from 'node:fs';

const text = fs.readFileSync('client/src/App.tsx', 'utf8');
const lines = text.split(/\r?\n/);
const importEnd = lines.findIndex((l) => l.startsWith('const LOOP_SHORTCUT') || l.startsWith('export function App'));
const importBlock = lines.slice(0, importEnd).join('\n');
const body = lines.slice(importEnd).join('\n');

const names = [];
for (const m of importBlock.matchAll(/import\s+(?:type\s+)?(?:(\w+)|\{([^}]+)\}|(\w+),\s*\{([^}]+)\})\s+from/g)) {
  if (m[1]) names.push(m[1]);
  if (m[3]) names.push(m[3]);
  const inner = m[2] || m[4] || '';
  for (const part of inner.split(',')) {
    const raw = part.trim();
    if (!raw) continue;
    const local = raw.replace(/^type\s+/, '').replace(/^.*\s+as\s+/, '').trim();
    if (local) names.push(local);
  }
}

const unused = [];
const used = [];
for (const name of names) {
  const re = new RegExp(`\\b${name}\\b`);
  if (re.test(body)) used.push(name);
  else unused.push(name);
}
console.log('USED:');
for (const n of used) console.log(`  ${n}`);
console.log(`${unused.length} unused / ${used.length} used / ${names.length} imported`);
