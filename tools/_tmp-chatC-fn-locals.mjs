// Find indent-2 const/let/function declarations inside a function and later references.
// Usage: node tools/_tmp-chatC-fn-locals.mjs <file> <start> <end>
import fs from 'node:fs';

const file = process.argv[2];
const start = Number(process.argv[3]);
const end = Number(process.argv[4]);
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const slice = lines.slice(start - 1, end);

const declRe = /^  (?:const|let|var|function) ([A-Za-z_$][\w$]*)/;
const decls = [];
slice.forEach((line, i) => {
  const m = declRe.exec(line);
  if (m) decls.push({ name: m[1], line: start + i, kind: line.trim().slice(0, 80) });
});

const body = slice.join('\n');
console.log(`indent-2 locals: ${decls.length}`);
for (const d of decls) {
  const re = new RegExp(`\\b${d.name.replace(/\$/g, '\\$')}\\b`, 'g');
  const n = (body.match(re) || []).length;
  // last reference line
  let last = d.line;
  for (let i = 0; i < slice.length; i++) {
    const re2 = new RegExp(`\\b${d.name.replace(/\$/g, '\\$')}\\b`);
    if (re2.test(slice[i])) last = start + i;
  }
  console.log(`${String(d.line).padStart(6)} last=${String(last).padStart(6)}  x${String(n).padStart(4)}  ${d.name}`);
}
