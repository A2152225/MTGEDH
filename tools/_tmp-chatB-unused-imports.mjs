// Chat B split helper: list imported bindings a file no longer uses.
// The workspace tsconfig has noUnusedLocals off, so extracting a cluster silently leaves the
// parent importing symbols nothing calls any more.
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node tools/_tmp-chatB-unused-imports.mjs <file>');
  process.exit(1);
}

const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\r\n');

const importRanges = [];
const importRe = /^import\s+(?:type\s+)?(?:\{([\s\S]*?)\}|(\w+))\s*from\s*'([^']+)';$/;

for (let i = 0; i < lines.length; i += 1) {
  if (!/^import\s/.test(lines[i])) continue;
  let end = i;
  while (end < lines.length && !/;\s*$/.test(lines[end])) end += 1;
  const block = lines.slice(i, end + 1).join('\n');
  const m = importRe.exec(block.replace(/\n/g, ''));
  if (m) {
    const names = m[1] ? m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop().trim()).filter(Boolean) : [m[2]];
    importRanges.push({ start: i + 1, end: end + 1, names, from: m[3] });
  }
  i = end;
}

const importLineNumbers = new Set();
for (const r of importRanges) for (let n = r.start; n <= r.end; n += 1) importLineNumbers.add(n);

const bodyText = lines.filter((_, idx) => !importLineNumbers.has(idx + 1)).join('\n');

const apply = process.argv.includes('--apply');
const edits = [];
let unusedCount = 0;
for (const r of importRanges) {
  const unused = r.names.filter((n) => !new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`).test(bodyText));
  if (unused.length === 0) continue;
  unusedCount += unused.length;
  const whole = unused.length === r.names.length;
  console.log(`${String(r.start).padStart(6)}-${String(r.end).padEnd(6)} ${r.from}${whole ? ' (whole block)' : ''}`);
  for (const n of unused) console.log(`         ${n}`);
  const keep = r.names.filter((n) => !unused.includes(n));
  edits.push({ r, whole, keep });
}
console.log(`\n${unusedCount} unused imported bindings`);

if (apply && edits.length) {
  // Applied back to front so earlier line numbers stay valid.
  const out = [...lines];
  const isTypeOnly = (r) => /^import\s+type\s/.test(lines[r.start - 1]);
  for (const { r, whole, keep } of [...edits].reverse()) {
    if (whole) {
      out.splice(r.start - 1, r.end - r.start + 1);
      continue;
    }
    const rebuilt =
      keep.length === 1
        ? [`import ${isTypeOnly(r) ? 'type ' : ''}{ ${keep[0]} } from '${r.from}';`]
        : [
            `import ${isTypeOnly(r) ? 'type ' : ''}{`,
            ...keep.map((n) => `  ${n},`),
            `} from '${r.from}';`,
          ];
    out.splice(r.start - 1, r.end - r.start + 1, ...rebuilt);
  }
  fs.writeFileSync(file, out.join('\r\n'));
  console.log('applied');
}
