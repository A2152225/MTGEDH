// List indent-2 statements inside a function with byte sizes, for hoist planning.
// Usage: node tools/_tmp-chatC-indent2-blocks.mjs <file> <start> <end> [--min-bytes N]
import fs from 'node:fs';

const file = process.argv[2];
const start = Number(process.argv[3]);
const end = Number(process.argv[4]);
const minIdx = process.argv.indexOf('--min-bytes');
const minBytes = minIdx === -1 ? 400 : Number(process.argv[minIdx + 1]);

const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const slice = lines.slice(start - 1, end);
const blocks = [];
let i = 0;
while (i < slice.length) {
  const line = slice[i];
  const abs = start + i;
  if (/^  \S/.test(line) || /^  \/\/ =====/.test(line) || /^  \/\/ [A-Z]/.test(line)) {
    let j = i + 1;
    while (j < slice.length && !/^  \S/.test(slice[j]) && slice[j] !== '}') {
      j += 1;
    }
    const text = slice.slice(i, j).join('\n');
    const bytes = Buffer.byteLength(text, 'utf8');
    blocks.push({ start: abs, end: abs + (j - i) - 1, bytes, preview: line.trim().slice(0, 100) });
    i = j;
    continue;
  }
  i += 1;
}

let acc = 0;
let runStart = null;
let runEnd = null;
let runBytes = 0;
function flush() {
  if (runStart != null) {
    console.log(`RUN ${runStart}-${runEnd}  ${(runBytes / 1024).toFixed(1)} KB`);
  }
  runStart = null;
  runEnd = null;
  runBytes = 0;
}
for (const b of blocks) {
  if (b.bytes >= minBytes) {
    console.log(`${String(b.start).padStart(6)}-${String(b.end).padEnd(6)} ${(b.bytes / 1024).toFixed(1).padStart(5)} KB  ${b.preview}`);
  }
  if (runStart == null) runStart = b.start;
  runEnd = b.end;
  runBytes += b.bytes;
  if (runBytes >= 32 * 1024) {
    flush();
  }
}
flush();
console.log(`blocks: ${blocks.length}`);
