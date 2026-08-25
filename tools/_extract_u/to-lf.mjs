import fs from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node tools/_extract_u/to-lf.mjs <file>');
  process.exit(1);
}
const text = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
fs.writeFileSync(path, text);
console.log('converted to LF', path, text.length);
