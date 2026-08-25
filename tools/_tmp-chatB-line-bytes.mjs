// Chat B split helper: byte size of a line range (CRLF-aware), for sizing candidate clusters.
import fs from 'node:fs';

const [file, startArg, endArg] = process.argv.slice(2);
if (!file || !startArg || !endArg) {
  console.error('usage: node tools/_tmp-chatB-line-bytes.mjs <file> <startLine> <endLine>');
  process.exit(1);
}
const start = Number(startArg);
const end = Number(endArg);

const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\r\n');
let bytes = 0;
for (let n = start; n <= Math.min(end, lines.length); n += 1) {
  bytes += Buffer.byteLength(lines[n - 1], 'utf8') + 2;
}
console.log(`${file} ${start}-${end}: ${end - start + 1} lines, ${bytes} B (${(bytes / 1024).toFixed(1)} KB)`);
