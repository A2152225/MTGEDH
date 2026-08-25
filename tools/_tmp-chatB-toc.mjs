// Chat B split helper: table of contents for a megafile.
// Lists every top-level declaration with its start line and the byte size of the region
// running to the next top-level declaration, so clusters can be sized without reading the file.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/_tmp-chatB-toc.mjs <file> [--min-bytes N]');
  process.exit(1);
}
const minIdx = process.argv.indexOf('--min-bytes');
const minBytes = minIdx === -1 ? 0 : Number(process.argv[minIdx + 1]);

const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\r\n');

const declRe = /^(export\s+)?(async\s+)?(function|const|let|type|interface|class|enum)\s+([A-Za-z0-9_$]+)/;
const reexportRe = /^export\s*\{/;

const decls = [];
lines.forEach((line, i) => {
  const m = declRe.exec(line);
  if (m) {
    decls.push({ line: i + 1, kind: m[3], exported: Boolean(m[1]), name: m[4] });
    return;
  }
  if (reexportRe.test(line)) decls.push({ line: i + 1, kind: 'reexport', exported: true, name: line.slice(0, 90) });
  else if (/^import\s/.test(line)) decls.push({ line: i + 1, kind: 'import', exported: false, name: line.slice(0, 90) });
});

const byteOfLine = new Array(lines.length + 1);
let acc = 0;
for (let i = 0; i < lines.length; i += 1) {
  byteOfLine[i + 1] = acc;
  acc += Buffer.byteLength(lines[i], 'utf8') + 2;
}
byteOfLine[lines.length + 1] = Buffer.byteLength(text, 'utf8');

let total = 0;
for (let i = 0; i < decls.length; i += 1) {
  const d = decls[i];
  const endLine = i + 1 < decls.length ? decls[i + 1].line - 1 : lines.length;
  const bytes = byteOfLine[endLine + 1] - byteOfLine[d.line];
  d.endLine = endLine;
  d.bytes = bytes;
  total += bytes;
}

for (const d of decls) {
  if (d.bytes < minBytes) continue;
  const kb = (d.bytes / 1024).toFixed(1).padStart(7);
  console.log(
    `${String(d.line).padStart(6)}-${String(d.endLine).padEnd(6)} ${kb} KB  ${d.exported ? 'exp ' : '    '}${d.kind.padEnd(9)} ${d.name}`
  );
}
console.log(`\n${decls.length} declarations, ${(total / 1024).toFixed(1)} KB accounted`);
