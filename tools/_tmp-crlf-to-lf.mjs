import fs from 'node:fs';
const p = process.argv[2];
if (!p) {
  console.error('usage: node tools/_tmp-crlf-to-lf.mjs <file>');
  process.exit(1);
}
const buf = fs.readFileSync(p);
const text = buf.toString('utf8').replace(/\r\n/g, '\n');
fs.writeFileSync(p, text);
console.log(`lf ${p} ${text.length} chars first=${JSON.stringify(text.slice(0, 4))}`);
