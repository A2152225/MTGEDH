// Chat B split helper: measure how much of a file is taken up by long runs of non-ASCII
// characters (the mojibake-exploded character classes baked into the oracle parser regexes).
// Usage: node tools/_tmp-chatB-mojibake-scan.mjs <file> [minRunChars]
import fs from 'node:fs';

const [file, minArg] = process.argv.slice(2);
const minRun = Number(minArg || 16);
const text = fs.readFileSync(file, 'utf8');
const total = Buffer.byteLength(text, 'utf8');

const runRe = /[^\x00-\x7F]{2,}/gu;
let runs = 0;
let runBytes = 0;
let biggest = 0;
const perLine = new Map();

const lines = text.split('\r\n');
lines.forEach((line, i) => {
  let m;
  runRe.lastIndex = 0;
  while ((m = runRe.exec(line)) !== null) {
    if (m[0].length < minRun) continue;
    const bytes = Buffer.byteLength(m[0], 'utf8');
    runs += 1;
    runBytes += bytes;
    if (bytes > biggest) biggest = bytes;
    perLine.set(i + 1, (perLine.get(i + 1) || 0) + bytes);
  }
});

console.log(`file        : ${file}`);
console.log(`total       : ${total} B (${(total / 1024).toFixed(1)} KB)`);
console.log(`mojibake    : ${runBytes} B (${(runBytes / 1024).toFixed(1)} KB) in ${runs} runs >= ${minRun} chars`);
console.log(`share       : ${((runBytes / total) * 100).toFixed(1)}% of the file`);
console.log(`biggest run : ${biggest} B`);
console.log(`lines hit   : ${perLine.size}`);

const top = [...perLine.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
console.log('\ntop lines by mojibake bytes:');
for (const [line, bytes] of top) console.log(`  line ${String(line).padStart(5)}  ${String(bytes).padStart(7)} B`);
