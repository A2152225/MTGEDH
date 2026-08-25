#!/usr/bin/env node
/**
 * Byte sizes for inclusive line ranges. CRLF-safe. Never rewrites the file.
 *
 * Usage: node tools/ts-cluster-range-bytes.mjs <file> label=START-END [label2=START-END ...]
 */
import fs from 'node:fs';

const file = process.argv[2];
const specs = process.argv.slice(3);
if (!file || specs.length === 0) {
  console.error('usage: node tools/ts-cluster-range-bytes.mjs <file> label=1-100 [label2=200-300 ...]');
  process.exit(1);
}

const buf = fs.readFileSync(file);
const text = buf.toString('utf8');
const lines = text.split(/\r?\n/);
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

for (const spec of specs) {
  const eq = spec.indexOf('=');
  const label = eq === -1 ? spec : spec.slice(0, eq);
  const range = eq === -1 ? spec : spec.slice(eq + 1);
  const [a, b] = range.split('-').map(Number);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < a || b > lines.length) {
    console.error(`bad range ${spec} (file has ${lines.length} lines)`);
    process.exit(1);
  }
  const bytes = byteOfLine[b + 1] - byteOfLine[a];
  const over = bytes > 40960 ? '  OVER CEILING' : bytes >= 36864 ? '  near ceiling' : '';
  console.log(`${label} (${a}-${b}): ${bytes} B  ~${(bytes / 1024).toFixed(1)} KB${over}`);
}
