// Temporary dependency analyzer for the postprocess/parser split campaign.
// Usage: node tools/_tmp-cluster-deps.mjs <file> <startLine> <endLine>
//
//   IN->OUT  : top-level symbols declared inside the range that are referenced outside it
//   OUT->IN  : top-level symbols declared outside the range that are referenced inside it
//   IMPORTS  : module-level imported bindings that the range references
import fs from 'node:fs';

const [, , file, startArg, endArg] = process.argv;
const start = Number(startArg);
const end = Number(endArg);
const source = fs.readFileSync(file, 'utf8');
const lines = source.split(/\r?\n/);

const declRe =
  /^(?:export\s+)?(?:declare\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/;

const decls = new Map();
lines.forEach((line, index) => {
  const match = declRe.exec(line);
  if (match) decls.set(match[1], index + 1);
});

const inside = [];
const outside = [];
for (const [name, line] of decls) {
  if (line >= start && line <= end) inside.push(name);
  else outside.push(name);
}

function countRefs(names, from, to) {
  const body = lines.slice(from - 1, to).join('\n');
  const hits = new Map();
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`, 'g');
    const n = (body.match(re) || []).length;
    if (n > 0) hits.set(name, n);
  }
  return hits;
}

const inToOut = new Map();
for (const [name, n] of countRefs(inside, 1, start - 1)) inToOut.set(name, n);
for (const [name, n] of countRefs(inside, end + 1, lines.length)) {
  inToOut.set(name, (inToOut.get(name) || 0) + n);
}
const outToIn = countRefs(outside, start, end);

// Collect module-level import bindings: name -> { source, typeOnly }
const importBindings = new Map();
const importRe = /^import\s+(type\s+)?\{([\s\S]*?)\}\s*from\s*'([^']+)';/gm;
let match;
while ((match = importRe.exec(source)) !== null) {
  const typeOnlyClause = Boolean(match[1]);
  const spec = match[3];
  for (const rawPart of match[2].split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    const typeOnlyMember = /^type\s+/.test(part);
    const name = part.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();
    if (name) importBindings.set(name, { spec, typeOnly: typeOnlyClause || typeOnlyMember });
  }
}

const usedImports = countRefs([...importBindings.keys()], start, end);

console.log(`file  : ${file}`);
console.log(`range : ${start}-${end}  (${end - start + 1} lines)`);
console.log('');

console.log(`IN->OUT (parent must re-import these): ${inToOut.size}`);
for (const [name, n] of [...inToOut].sort((a, b) => b[1] - a[1])) console.log(`  ${name}  x${n}`);
console.log('');

console.log(`OUT->IN (cluster needs from rest of parent): ${outToIn.size}`);
for (const [name, n] of [...outToIn].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${name}  x${n}  (line ${decls.get(name)})`);
}
console.log('');

const bySpec = new Map();
for (const [name] of usedImports) {
  const info = importBindings.get(name);
  if (!bySpec.has(info.spec)) bySpec.set(info.spec, { value: [], type: [] });
  bySpec.get(info.spec)[info.typeOnly ? 'type' : 'value'].push(name);
}
console.log('IMPORTS the cluster needs:');
for (const [spec, groups] of [...bySpec].sort()) {
  if (groups.type.length > 0) {
    console.log(`import type { ${groups.type.sort().join(', ')} } from '${spec}';`);
  }
  if (groups.value.length > 0) {
    console.log(`import { ${groups.value.sort().join(', ')} } from '${spec}';`);
  }
}
