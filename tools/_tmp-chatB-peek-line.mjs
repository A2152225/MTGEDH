// Chat B split helper: peek at the head/tail of very long lines without ingesting them.
// Usage: node tools/_tmp-chatB-peek-line.mjs <file> <startLine> <endLine> [chars]
import fs from 'node:fs';

const [file, startArg, endArg, charsArg] = process.argv.slice(2);
const start = Number(startArg);
const end = Number(endArg);
const chars = Number(charsArg || 220);
const lines = fs.readFileSync(file, 'utf8').split('\r\n');

for (let n = start; n <= end; n += 1) {
  const line = lines[n - 1] ?? '';
  const size = Buffer.byteLength(line, 'utf8');
  if (size <= chars * 2) {
    console.log(`${n} [${size}B] ${line}`);
    continue;
  }
  console.log(`${n} [${size}B] HEAD ${line.slice(0, chars)}`);
  console.log(`${' '.repeat(String(n).length)}      TAIL ${line.slice(-chars)}`);
}
