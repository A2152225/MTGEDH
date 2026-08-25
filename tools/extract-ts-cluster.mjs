#!/usr/bin/env node
/**
 * Byte-exact TypeScript cluster extract. Copies a line range as raw buffers.
 * Preserves CRLF vs LF. Never reprints / pretty-prints / organizes imports.
 *
 * Do not use ts-morph, jscodeshift, recast, or tools/_refactor_scratch dump-and-cut.
 *
 * Usage:
 *   node tools/extract-ts-cluster.mjs --parent <file> --start N --end M \
 *     --out <newFile> --header <header.txt> --replacement <replacement.txt> \
 *     [--export] [--allow-nested] [--dry]
 *
 * --header / --replacement / --footer are optional files. Their newlines are rewritten to
 * match the parent. --export prefixes `export ` on the moved body if missing.
 * --allow-nested allows an indented start (socket.on bodies inside registerX).
 * --dry prints sizes and seams without writing.
 */
import fs from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  if (key === 'dry' || key === 'allow-nested' || key === 'allow-any' || key === 'export') {
    args.set(key, true);
  } else {
    args.set(key, process.argv[i + 1]);
    i += 1;
  }
}

const parentPath = args.get('parent');
const outPath = args.get('out');
const start = Number(args.get('start'));
const end = Number(args.get('end'));
const dry = args.get('dry') === true;

if (!parentPath || !outPath || !Number.isFinite(start) || !Number.isFinite(end)) {
  console.error(`usage: node tools/extract-ts-cluster.mjs --parent <file> --start N --end M --out <newFile> [--header <file>] [--replacement <file>] [--export] [--allow-nested] [--dry]`);
  process.exit(1);
}

const original = fs.readFileSync(parentPath);
const crlfCount = original.toString('utf8').split('\r\n').length - 1;
const parentIsCrlf = crlfCount > original.toString('utf8').split('\n').length / 2;

const lineStarts = [0];
for (let i = 0; i < original.length; i += 1) {
  if (original[i] === 0x0a) lineStarts.push(i + 1);
}
const totalLines = lineStarts.length;

if (start < 1 || end < start || end > totalLines) {
  console.error(`range ${start}-${end} out of bounds (file has ${totalLines} lines)`);
  process.exit(1);
}

const sliceStart = lineStarts[start - 1];
const sliceEnd = end < totalLines ? lineStarts[end] : original.length;

const originalText = original.toString('utf8');
const originalLines = originalText.split(/\r?\n/);
const lineAt = (n) => originalLines[n - 1] ?? '';
const prev = lineAt(start - 1).trim();
const first = lineAt(start);
const last = lineAt(end).trim();

const problems = [];
if (prev !== '' && !/[;}]$/.test(prev) && !prev.endsWith('{')) {
  if (prev !== '}') problems.push(`line ${start - 1} before the range is a continuation: "${prev}"`);
}
const allowNested = args.get('allow-nested') === true;
const allowAny = args.get('allow-any') === true;
if (!allowNested && !allowAny && (/^\s/.test(first) || first.trim() === '')) {
  problems.push(`line ${start} is not a top-level declaration: "${first}"`);
}
if (last !== '' && last !== '}' && !/[;}]$/.test(last)) {
  problems.push(`line ${end} does not close a statement: "${last}"`);
}
if (problems.length > 0) {
  console.error('BOUNDARY GUARD FAILED - refusing to slice:');
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

const before = original.subarray(0, sliceStart);
const moved = original.subarray(sliceStart, sliceEnd);
const after = original.subarray(sliceEnd);

if (!Buffer.concat([before, moved, after]).equals(original)) {
  console.error('IDENTITY CHECK FAILED - refusing to write');
  process.exit(1);
}

function toParentNewlines(text) {
  const lf = text.replace(/\r\n/g, '\n');
  return parentIsCrlf ? lf.replace(/\n/g, '\r\n') : lf;
}

function readFixture(key) {
  const path = args.get(key);
  if (!path) return Buffer.alloc(0);
  return Buffer.from(toParentNewlines(fs.readFileSync(path, 'utf8')), 'utf8');
}

let movedOut = moved;
if (args.get('export') === true) {
  const movedText = moved.toString('utf8');
  if (!/^(export\s)/.test(movedText)) {
    movedOut = Buffer.from(`export ${movedText}`, 'utf8');
  }
}

const header = readFixture('header');
const footer = readFixture('footer');
const replacement = readFixture('replacement');

const newFile = Buffer.concat([header, movedOut, footer]);
const newParent = Buffer.concat([before, replacement, after]);

console.log(`parent      : ${parentPath}  ${parentIsCrlf ? 'CRLF' : 'LF'}`);
console.log(`range       : ${start}-${end} (${end - start + 1} lines, ${moved.length} B)`);
console.log(`new file    : ${outPath}  ${newFile.length} B (${(newFile.length / 1024).toFixed(1)} KB)`);
console.log(`parent after: ${newParent.length} B (${(newParent.length / 1024).toFixed(1)} KB), was ${original.length} B`);
console.log(`identity    : OK`);

if (newFile.length > 40960) {
  console.error(`LEAF OVER CEILING: ${newFile.length} B > 40960. Split the cluster instead of packing.`);
  if (!dry) process.exit(1);
}

if (dry) {
  console.log('dry run - nothing written');
} else {
  if (fs.existsSync(outPath)) {
    console.error(`refusing to overwrite existing ${outPath}`);
    process.exit(1);
  }
  fs.writeFileSync(outPath, newFile);
  fs.writeFileSync(parentPath, newParent);
  console.log('written');
}

function show(label, buffer, fromLine, toLine) {
  const rows = buffer.toString('utf8').split('\n');
  console.log(`\n--- ${label} (lines ${fromLine}-${toLine}) ---`);
  for (let i = fromLine; i <= Math.min(toLine, rows.length); i += 1) {
    const row = rows[i - 1] ?? '';
    const eol = row.endsWith('\r') ? 'CRLF' : i < rows.length ? ' LF' : '  --';
    console.log(`${String(i).padStart(6)} ${eol} |${row.replace(/\r$/, '')}`);
  }
}

const replacementLines = Math.max(0, replacement.toString('utf8').split('\n').length - 1);
show('parent seam', newParent, Math.max(1, start - 3), start + replacementLines + 2);
const newFileLines = newFile.toString('utf8').split('\n').length;
show('new file head', newFile, 1, Math.min(12, newFileLines));
show('new file tail', newFile, Math.max(1, newFileLines - 6), newFileLines);
