// Chat B split helper: split one huge `return (A || B || C || ...)` predicate into sibling
// modules, byte-exactly and in order.
//
// Each slice becomes
//
//     export function isChunk(normalizedText: string): boolean {
//       return (
//     <moved operand lines, each still ending in "||">
//         false
//       );
//     }
//
// so the moved bytes are never retyped. `X || false` is identical to `X` for boolean operands,
// and the parent keeps a call in the slice's original position, so evaluation order is unchanged.
//
// Usage:
//   node tools/_tmp-chatB-split-disjunction.mjs <plan.json> [--dry]
//
// Plan: { parent, returnOpenLine, returnCloseLine, locals: {name: type},
//         budget, modules: [{ out, name, headerText }] }

import fs from 'node:fs';

const planPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!planPath) {
  console.error('usage: node tools/_tmp-chatB-split-disjunction.mjs <plan.json> [--dry]');
  process.exit(1);
}
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

const original = fs.readFileSync(plan.parent);
const lineStarts = [0];
for (let i = 0; i < original.length; i += 1) {
  if (original[i] === 0x0a) lineStarts.push(i + 1);
}
const lines = original.toString('utf8').split('\r\n');
const lineAt = (n) => lines[n - 1] ?? '';

// --- depth-aware operand boundaries -----------------------------------------------------
function scanLine(line, state) {
  let { depth, inBlockComment, inTemplate, prevMeaningful } = state;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const next = line[i + 1];
    if (inBlockComment) {
      if (c === '*' && next === '/') { inBlockComment = false; i += 2; continue; }
      i += 1;
      continue;
    }
    if (inTemplate) {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { inTemplate = false; prevMeaningful = '`'; i += 1; continue; }
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') break;
    if (c === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
    if (c === '`') { inTemplate = true; i += 1; continue; }
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === quote) { i += 1; break; }
        i += 1;
      }
      prevMeaningful = 'x';
      continue;
    }
    if (c === '/' && (prevMeaningful === '' || '(,=:[!&|?{};+*%~^<>'.includes(prevMeaningful))) {
      i += 1;
      let inClass = false;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === '[') inClass = true;
        else if (line[i] === ']') inClass = false;
        else if (line[i] === '/' && !inClass) { i += 1; break; }
        i += 1;
      }
      while (i < line.length && /[a-z]/.test(line[i])) i += 1;
      prevMeaningful = 'x';
      continue;
    }
    if (c === '{' || c === '(' || c === '[') depth += 1;
    else if (c === '}' || c === ')' || c === ']') depth -= 1;
    if (!/\s/.test(c)) prevMeaningful = c;
    i += 1;
  }
  return { depth, inBlockComment, inTemplate, prevMeaningful };
}

const first = plan.returnOpenLine + 1;
const last = plan.returnCloseLine - 1;

let state = { depth: 1, inBlockComment: false, inTemplate: false, prevMeaningful: '(' };
const operands = [];
let start = first;
for (let n = first; n <= last; n += 1) {
  state = scanLine(lineAt(n), state);
  if (state.depth === 1 && /\|\|$/.test(lineAt(n).trim())) {
    operands.push({ start, end: n });
    start = n + 1;
  }
}
if (start <= last) operands.push({ start, end: last, tail: true });

const byteLen = (o) => {
  const a = lineStarts[o.start - 1];
  const b = o.end < lines.length ? lineStarts[o.end] : original.length;
  return b - a;
};

console.log(`${operands.length} operands between lines ${first} and ${last}`);
const tail = operands[operands.length - 1];
if (tail.tail) {
  console.log(`last operand (${tail.start}-${tail.end}) has no trailing || and stays in the parent`);
  operands.pop();
}

// --- group into modules -------------------------------------------------------------------
const budget = plan.budget || 26000;
const groups = [];
let group = null;
for (const op of operands) {
  const size = byteLen(op);
  if (!group || group.bytes + size > budget) {
    group = { ops: [], bytes: 0 };
    groups.push(group);
  }
  group.ops.push(op);
  group.bytes += size;
}

if (groups.length > plan.modules.length) {
  console.error(`need ${groups.length} module names, plan has ${plan.modules.length}`);
  for (const g of groups) console.error(`  ${g.ops[0].start}-${g.ops[g.ops.length - 1].end}  ${(g.bytes / 1024).toFixed(1)} KB`);
  process.exit(1);
}

// --- build ---------------------------------------------------------------------------------
const localNames = Object.keys(plan.locals);
const parentPieces = [];
const outputs = [];
let cursor = 0;

groups.forEach((g, gi) => {
  const mod = plan.modules[gi];
  const from = g.ops[0].start;
  const to = g.ops[g.ops.length - 1].end;
  const sliceStart = lineStarts[from - 1];
  const sliceEnd = to < lines.length ? lineStarts[to] : original.length;

  parentPieces.push(original.subarray(cursor, sliceStart));
  const moved = original.subarray(sliceStart, sliceEnd);
  cursor = sliceEnd;

  const text = moved.toString('utf8');
  const used = localNames.filter((n) => new RegExp(`\\b${n}\\b`).test(text));
  const params = used.map((n) => `${n}: ${plan.locals[n]}`).join(', ');
  const args = used.join(', ');

  outputs.push({
    out: mod.out,
    buffer: Buffer.concat([
      Buffer.from(mod.headerText.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8'),
      Buffer.from(`export function ${mod.name}(${params}): boolean {\r\n  return (\r\n`, 'utf8'),
      moved,
      Buffer.from('    false\r\n  );\r\n}\r\n', 'utf8'),
    ]),
  });

  parentPieces.push(Buffer.from(`    ${mod.name}(${args}) ||\r\n`, 'utf8'));
  console.log(`${mod.out}  lines ${from}-${to}  ${(g.bytes / 1024).toFixed(1)} KB  args(${args})`);
});
parentPieces.push(original.subarray(cursor));

// Identity: untouched parent regions plus moved regions must rebuild the original.
const verify = [];
let vc = 0;
for (const g of groups) {
  const from = g.ops[0].start;
  const to = g.ops[g.ops.length - 1].end;
  const s = lineStarts[from - 1];
  const e = to < lines.length ? lineStarts[to] : original.length;
  verify.push(original.subarray(vc, s), original.subarray(s, e));
  vc = e;
}
verify.push(original.subarray(vc));
if (!Buffer.concat(verify).equals(original)) {
  console.error('IDENTITY CHECK FAILED - refusing to write');
  process.exit(1);
}
console.log('identity    : OK (untouched + moved === original)');

const newParent = Buffer.concat(parentPieces);
console.log(`parent after: ${newParent.length} B (${(newParent.length / 1024).toFixed(1)} KB), was ${original.length} B`);

if (dry) {
  console.log('dry run - nothing written');
  process.exit(0);
}
for (const o of outputs) {
  if (fs.existsSync(o.out)) {
    console.error(`refusing to overwrite existing ${o.out}`);
    process.exit(1);
  }
}
for (const o of outputs) fs.writeFileSync(o.out, o.buffer);
fs.writeFileSync(plan.parent, newParent);
console.log('written');
