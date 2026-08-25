#!/usr/bin/env node
/**
 * Which parent symbols a line range defines vs references, plus imports used in-range.
 * Identifier hits are regex word-boundary (comments can false-positive). Never rewrites.
 *
 * Usage: node tools/ts-cluster-deps.mjs <file> <startLine> <endLine>
 */
import fs from 'node:fs';

const [, , file, startArg, endArg] = process.argv;
const start = Number(startArg);
const end = Number(endArg);
if (!file || !Number.isFinite(start) || !Number.isFinite(end)) {
  console.error('usage: node tools/ts-cluster-deps.mjs <file> <start> <end>');
  process.exit(1);
}
const source = fs.readFileSync(file, 'utf8');
const lines = source.split(/\r?\n/);

const declRe =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

const decls = new Map();
lines.forEach((line, index) => {
  const match = declRe.exec(line);
  if (match) decls.set(match[1], index + 1);
});

const inside = [];
const outside = [];
for (const [name, line] of decls) {
  if (line >= start && line <= end) inside.push(name);
  else outside.push(name);
}

function countRefs(names, from, to) {
  const body = lines.slice(from - 1, to).join('\n');
  const hits = new Map();
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
    const n = (body.match(re) || []).length;
    if (n > 0) hits.set(name, n);
  }
  return hits;
}

const inToOut = new Map();
for (const [name, n] of countRefs(inside, 1, start - 1)) inToOut.set(name, n);
for (const [name, n] of countRefs(inside, end + 1, lines.length)) {
  inToOut.set(name, (inToOut.get(name) || 0) + n);
}
const outToIn = countRefs(outside, start, end);

const importBindings = new Map();
const importRe = /^import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"]/gm;
let match;
while ((match = importRe.exec(source)) !== null) {
  const typeOnlyClause = Boolean(match[1]);
  const spec = match[3];
  for (const rawPart of match[2].split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const typeOnlyMember = /^type\s+/.test(part);
    const name = part.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
    if (name) importBindings.set(name, { spec, typeOnly: typeOnlyClause || typeOnlyMember });
  }
}
const defaultImportRe = /^import\s+(type\s+)?([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gm;
while ((match = defaultImportRe.exec(source)) !== null) {
  importBindings.set(match[2], { spec: match[3], typeOnly: Boolean(match[1]) });
}
const starImportRe = /^import\s+\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"]([^'"]+)['"]/gm;
while ((match = starImportRe.exec(source)) !== null) {
  importBindings.set(match[1], { spec: match[2], typeOnly: false });
}

const usedImports = countRefs([...importBindings.keys()], start, end);

console.log(`file  : ${file}`);
console.log(`range : ${start}-${end}  (${end - start + 1} lines)`);
console.log('');

console.log(`IN->OUT (parent must re-import these): ${inToOut.size}`);
for (const [name, n] of [...inToOut].sort((a, b) => b[1] - a[1])) console.log(`  ${name}  x${n}`);
console.log('');

console.log(`OUT->IN (cluster needs from rest of parent): ${outToIn.size}`);
for (const [name, n] of [...outToIn].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}  x${n}  (line ${decls.get(name)})`);
}
console.log('');

console.log(`IMPORTS used in range: ${usedImports.size}`);
for (const [name, n] of [...usedImports].sort((a, b) => b[1] - a[1])) {
  const info = importBindings.get(name);
  console.log(`  ${name}  x${n}  from ${info.spec}${info.typeOnly ? ' (type)' : ''}`);
}
