// Temporary byte-exact cluster extractor for the postprocess/parser split campaign.
//
// Moves an exact line range out of <parent> into <out>, prepending <header> to the new
// file and leaving <replacement> (import / re-export lines) behind in the parent.
//
// The moved region is copied as raw bytes, never re-encoded or re-joined, so CRLF endings
// and the literal U+FFFD characters baked into the oracle postprocess source survive
// untouched. The script refuses to write unless
//   parentBefore + movedBytes + parentAfter === originalBytes
// proving the split is lossless.
//
// Usage:
//   node tools/_tmp-extract-cluster.mjs --parent <file> --start N --end M \
//     --out <newFile> --header <headerTxt> --replacement <replacementTxt> [--dry]
import fs from 'node:fs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (!arg.startsWith('--')) continue;
  const key = arg.slice(2);
  if (key === 'dry' || key === 'allow-nested' || key === 'allow-any') args.set(key, true);
  else {
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
  console.error('missing required args');
  process.exit(1);
}

const original = fs.readFileSync(parentPath);

// Byte offset where each 1-based line begins.
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

// Boundary guard: a cluster must begin at a top-level declaration and must not start in the
// middle of a multi-line statement. Slicing into the tail of an earlier import block is the
// one mistake this tool cannot detect after the fact.
const originalLines = original.toString('utf8').split('\r\n');
const lineAt = (n) => originalLines[n - 1] ?? '';
const prev = lineAt(start - 1).trim();
const first = lineAt(start);
const last = lineAt(end).trim();

const problems = [];
if (prev !== '' && !/[;}]$/.test(prev)) {
  problems.push(`line ${start - 1} before the range is a continuation: "${prev}"`);
}
const allowNested = args.get('allow-nested') === true;
const allowAny = args.get('allow-any') === true;
if (!allowNested && !allowAny && (/^\s/.test(first) || first.trim() === '')) {
  problems.push(`line ${start} is not a top-level declaration: "${first}"`);
}
if (allowNested && !allowAny && !/^\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|var)\b/.test(first)) {
  problems.push(`line ${start} is not a nested declaration: "${first.trim()}"`);
}
if (last !== '' && last !== '}' && !/[;}]$/.test(last)) {
  problems.push(`line ${end} does not close a statement: "${last}"`);
}
if (problems.length > 0) {
  console.error('BOUNDARY GUARD FAILED - refusing to slice:');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('context:');
  for (let n = Math.max(1, start - 4); n <= start + 1; n += 1) {
    console.error(`${String(n).padStart(6)} |${lineAt(n)}`);
  }
  for (let n = Math.max(1, end - 1); n <= Math.min(totalLines, end + 2); n += 1) {
    console.error(`${String(n).padStart(6)} |${lineAt(n)}`);
  }
  process.exit(1);
}

const before = original.subarray(0, sliceStart);
const moved = original.subarray(sliceStart, sliceEnd);
const after = original.subarray(sliceEnd);

if (!Buffer.concat([before, moved, after]).equals(original)) {
  console.error('IDENTITY CHECK FAILED - refusing to write');
  process.exit(1);
}

function toCrlf(text) {
  return text.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
}

function readFixture(key) {
  const path = args.get(key);
  if (!path) return Buffer.alloc(0);
  return Buffer.from(toCrlf(fs.readFileSync(path, 'utf8')), 'utf8');
}

const header = readFixture('header');
const footer = readFixture('footer');
const replacement = readFixture('replacement');

const newFile = Buffer.concat([header, moved, footer]);
const newParent = Buffer.concat([before, replacement, after]);

console.log(`parent      : ${parentPath}`);
console.log(`range       : ${start}-${end} (${end - start + 1} lines, ${moved.length} B)`);
console.log(`new file    : ${outPath}  ${newFile.length} B (${(newFile.length / 1024).toFixed(1)} KB)`);
console.log(`parent after: ${newParent.length} B (${(newParent.length / 1024).toFixed(1)} KB), was ${original.length} B`);
console.log(`identity    : OK (before+moved+after === original)`);

if (dry) {
  console.log('dry run - nothing written');
  process.exit(0);
}

if (fs.existsSync(outPath)) {
  console.error(`refusing to overwrite existing ${outPath}`);
  process.exit(1);
}

fs.writeFileSync(outPath, newFile);
fs.writeFileSync(parentPath, newParent);
console.log('written');

// Neighbor verification: show the seam in the parent and both ends of the new file so a
// stray CRLF, merged line or truncated import is visible without re-reading either file.
function show(label, buffer, fromLine, toLine) {
  const text = buffer.toString('utf8');
  const rows = text.split('\n');
  console.log(`\n--- ${label} (lines ${fromLine}-${toLine}) ---`);
  for (let i = fromLine; i <= Math.min(toLine, rows.length); i += 1) {
    const row = rows[i - 1] ?? '';
    const eol = row.endsWith('\r') ? 'CRLF' : i < rows.length ? ' LF!' : '  --';
    console.log(`${String(i).padStart(6)} ${eol} |${row.replace(/\r$/, '')}`);
  }
}

const replacementLines = replacement.toString('utf8').split('\n').length - 1;
show('parent seam', newParent, Math.max(1, start - 3), start + replacementLines + 2);
const newFileLines = newFile.toString('utf8').split('\n').length;
show('new file head', newFile, 1, header.toString('utf8').split('\n').length + 2);
show('new file tail', newFile, Math.max(1, newFileLines - 6), newFileLines);
