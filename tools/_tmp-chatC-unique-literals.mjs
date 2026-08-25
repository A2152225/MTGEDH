// Compare unique string/regex literals in two line ranges (leftover vs folder).
// Usage: node tools/_tmp-chatC-unique-literals.mjs <fileA> <aStart> <aEnd> <fileB> <bStart> <bEnd>
import fs from 'node:fs';

const [, , fileA, aStartArg, aEndArg, fileB, bStartArg, bEndArg] = process.argv;
const aStart = Number(aStartArg);
const aEnd = Number(aEndArg);
const bStart = Number(bStartArg);
const bEnd = Number(bEndArg);

function slice(file, start, end) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  return lines.slice(start - 1, end).join('\n');
}

function literals(text) {
  const out = new Set();
  const re = /(?:`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/(?:\\.|[^/\\\n])+\/[gimsuy]*)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const v = m[0];
    if (v.length < 8) continue;
    out.add(v.slice(0, 160));
  }
  return out;
}

const a = literals(slice(fileA, aStart, aEnd));
const b = literals(slice(fileB, bStart, bEnd));
const onlyA = [...a].filter((x) => !b.has(x));
const onlyB = [...b].filter((x) => !a.has(x));
console.log(`A-only (${fileA}:${aStart}-${aEnd}): ${onlyA.length}`);
for (const x of onlyA.slice(0, 40)) console.log(`  A ${x}`);
if (onlyA.length > 40) console.log(`  ... ${onlyA.length - 40} more`);
console.log('');
console.log(`B-only (${fileB}:${bStart}-${bEnd}): ${onlyB.length}`);
for (const x of onlyB.slice(0, 40)) console.log(`  B ${x}`);
if (onlyB.length > 40) console.log(`  ... ${onlyB.length - 40} more`);
