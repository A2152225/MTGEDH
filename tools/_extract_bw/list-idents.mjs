#!/usr/bin/env node
/**
 * List identifiers used in a line range that are declared elsewhere in the same file.
 * Inventory only — never rewrites.
 *
 * Usage: node tools/_extract_bw/list-idents.mjs <file> <start> <end>
 */
import fs from 'node:fs';

const [, , file, startArg, endArg] = process.argv;
const start = Number(startArg);
const end = Number(endArg);
if (!file || !Number.isFinite(start) || !Number.isFinite(end)) {
  console.error('usage: node tools/_extract_bw/list-idents.mjs <file> <start> <end>');
  process.exit(1);
}

const source = fs.readFileSync(file, 'utf8');
const lines = source.split(/\r?\n/);
const body = lines.slice(start - 1, end).join('\n');

const declRe =
  /^(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/;
const nestedDeclRe =
  /^  (?:const|let|function)\s+([A-Za-z_$][\w$]*)/;
const useStateRe = /^  const \[([^\]]+)\]\s*=/;
const destructureNameRe = /^    ([A-Za-z_$][\w$]*)/;

const declared = new Map();
for (let i = 0; i < lines.length; i += 1) {
  const line = lines[i];
  const top = declRe.exec(line);
  if (top) declared.set(top[1], i + 1);
  const nested = nestedDeclRe.exec(line);
  if (nested) declared.set(nested[1], i + 1);
  const state = useStateRe.exec(line);
  if (state) {
    for (const raw of state[1].split(',')) {
      const name = raw.trim();
      if (name) declared.set(name, i + 1);
    }
  }
  const dest = destructureNameRe.exec(line);
  if (dest) declared.set(dest[1], i + 1);
}

// useGameSocket / hook destructure members
for (let i = 0; i < lines.length; i += 1) {
  const m = /^    ([A-Za-z_$][\w$]*),?\s*(?:=\s*.+)?$/.exec(lines[i]);
  if (m && i < start - 1) declared.set(m[1], i + 1);
}

const used = [];
for (const [name, line] of declared) {
  if (line >= start && line <= end) continue;
  const re = new RegExp(`\\b${name.replace(/\\$/g, '\\$')}\\b`);
  if (re.test(body)) used.push({ name, line });
}

used.sort((a, b) => a.name.localeCompare(b.name));
console.log(`range ${start}-${end}: ${used.length} outer idents`);
for (const { name, line } of used) {
  console.log(`  ${name}  (decl ${line})`);
}
