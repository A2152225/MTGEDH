#!/usr/bin/env node
/**
 * Top-level declarations with line ranges and byte sizes.
 * Handles CRLF, LF, and mixed endings. Never re-encodes the file.
 *
 * Usage: node tools/ts-cluster-toc.mjs <file> [--min-bytes N]
 */
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/ts-cluster-toc.mjs <file> [--min-bytes N]');
  process.exit(1);
}
const minIdx = process.argv.indexOf('--min-bytes');
const minBytes = minIdx === -1 ? 0 : Number(process.argv[minIdx + 1]);

const buf = fs.readFileSync(file);
const text = buf.toString('utf8');
const crlf = (text.match(/\r\n/g) || []).length;
const lfOnly = (text.match(/(?<!\r)\n/g) || []).length;
const crOnly = (text.match(/\r(?!\n)/g) || []).length;
const lines = text.split(/\r?\n/);

const declRe = /^(export\s+)?(async\s+)?(function|const|let|type|interface|class|enum)\s+([A-Za-z0-9_$]+)/;
const reexportRe = /^export\s*\{/;

const decls = [];
lines.forEach((line, i) => {
  const m = declRe.exec(line);
  if (m) {
    decls.push({ line: i + 1, kind: m[3], exported: Boolean(m[1]), name: m[4] });
    return;
  }
  if (reexportRe.test(line)) decls.push({ line: i + 1, kind: 'reexport', exported: true, name: line.slice(0, 90) });
  else if (/^import\s/.test(line)) decls.push({ line: i + 1, kind: 'import', exported: false, name: line.slice(0, 90) });
});

const byteOfLine = new Array(lines.length + 1);
let acc = 0;
for (let i = 0; i < lines.length; i += 1) {
  byteOfLine[i + 1] = acc;
  const ending = i < lines.length - 1
    ? (text[acc + Buffer.byteLength(lines[i], 'utf8')] === '\r' ? 2 : 1)
    : 0;
  acc += Buffer.byteLength(lines[i], 'utf8') + ending;
}
byteOfLine[lines.length + 1] = buf.length;

let total = 0;
for (let i = 0; i < decls.length; i += 1) {
  const d = decls[i];
  const endLine = i + 1 < decls.length ? decls[i + 1].line - 1 : lines.length;
  const bytes = byteOfLine[endLine + 1] - byteOfLine[d.line];
  d.endLine = endLine;
  d.bytes = bytes;
  total += bytes;
}

console.log(`file: ${file}`);
console.log(`bytes: ${buf.length}  lines: ${lines.length}  CRLF: ${crlf}  LF: ${lfOnly}  CR: ${crOnly}  BOM: ${buf[0] === 0xef}`);
console.log('');
for (const d of decls) {
  if (d.bytes < minBytes) continue;
  const kb = (d.bytes / 1024).toFixed(1).padStart(7);
  console.log(
    `${String(d.line).padStart(6)}-${String(d.endLine).padEnd(6)} ${kb} KB  ${d.exported ? 'exp ' : '    '}${d.kind.padEnd(9)} ${d.name}`
  );
}
console.log(`\n${decls.length} declarations, ${(total / 1024).toFixed(1)} KB accounted`);
