import fs from "node:fs";

// Chat H scratch: find contiguous runs of extractable blocks inside a big function.
// A depth-1 block is a "candidate" when it neither assigns nor mutates any outer local
// declared earlier in the function body, so hoisting it into
// `const r = tryX(...); if (r) return r;` cannot change behavior on the fall-through path.
// Runs also absorb `const parsedFoo = ...` declarations, provided nothing they declare is
// still referenced after the run ends.
// Usage: node tools/_tmp-chatH-guard-runs.mjs <file> <fnStartLine> [minRunKB]
const file = process.argv[2];
const minRunKB = Number(process.argv[3] ?? 8);

const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
// Derived, never passed in: a stale start line silently hides the outer `let` accumulators
// and every block that writes them then looks extractable.
const sigStart = lines.findIndex((l) => /^export function applyMoveZoneStep\b/.test(l));
if (sigStart < 0) throw new Error("applyMoveZoneStep not found");
let fnStart = sigStart;
while (!/^\)/.test(lines[fnStart])) fnStart += 1;
const byteOf = (i) => Buffer.byteLength(lines[i] ?? "", "utf8") + 2;

let fnEnd = lines.length;
const blocks = [];
let cur = null;
for (let i = fnStart; i < lines.length; i++) {
  if (/^\}/.test(lines[i])) {
    fnEnd = i;
    break;
  }
  const m = /^(\s*)(\S)/.exec(lines[i]);
  // A depth-1 line that closes a construct (`}`, `)`, `]`, `} else`) belongs to the
  // block above it, not to a new one.
  const opensBlock = m && m[1].length === 2 && !/^[)\]}]/.test(lines[i].trim());
  if (opensBlock) {
    if (cur) blocks.push(cur);
    cur = { start: i + 1, end: i + 1, head: lines[i].trim(), bytes: 0, body: [] };
  }
  if (cur) {
    cur.end = i + 1;
    cur.bytes += byteOf(i);
    cur.body.push(lines[i]);
  }
}
if (cur) blocks.push(cur);

const writeRe = (name) =>
  new RegExp(
    `\\b${name}\\b\\s*(?:=[^=]|\\+\\+|--|\\+=|-=|\\*=|\\?\\?=|\\|\\|=)|\\b${name}\\b\\s*\\.\\s*(?:push|pop|shift|unshift|splice|set|delete|add|clear|sort|reverse)\\s*\\(`
  );

const known = [];
for (const b of blocks) {
  const text = b.body.join("\n");
  b.text = text;
  const d = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(b.head);
  b.declares = d ? d[1] : null;
  b.isLet = /^let\s/.test(b.head);
  const outerRead = new Set();
  const outerWritten = new Set();
  for (const name of known) {
    if (!new RegExp(`\\b${name}\\b`).test(text)) continue;
    outerRead.add(name);
    if (writeRe(name).test(text)) outerWritten.add(name);
  }
  b.outerRead = outerRead;
  b.outerWritten = outerWritten;
  // `let` declarations are excluded: they are accumulator state for the rest of the body.
  b.candidate = outerWritten.size === 0 && !b.isLet;
  b.knownBefore = new Set(known);
  if (b.declares) known.push(b.declares);
}

const runs = [];
let run = null;
for (const b of blocks) {
  if (b.candidate) {
    if (!run) run = { blocks: [], bytes: 0 };
    run.blocks.push(b);
    run.bytes += b.bytes;
  } else if (run) {
    runs.push(run);
    run = null;
  }
}
if (run) runs.push(run);

for (const r of runs) {
  const first = r.blocks[0];
  const last = r.blocks[r.blocks.length - 1];
  r.start = first.start;
  r.end = last.end;
  // Params = outer locals declared before the run that the run reads.
  const declaredInRun = new Set(r.blocks.map((b) => b.declares).filter(Boolean));
  r.params = new Set();
  for (const b of r.blocks) {
    for (const name of b.outerRead) {
      if (!declaredInRun.has(name) && first.knownBefore.has(name)) r.params.add(name);
    }
  }
  const after = lines.slice(last.end, fnEnd).join("\n");
  r.escapes = [...declaredInRun].filter((n) => new RegExp(`\\b${n}\\b`).test(after));
  const body = r.blocks.map((b) => b.text).join("\n");
  r.badReturns = (body.match(/\breturn\s*(?:;|undefined|null|false)/g) ?? []).length;
}

runs.sort((a, b) => b.bytes - a.bytes);
let shown = 0;
for (const r of runs) {
  if (r.bytes < minRunKB * 1024) continue;
  shown += 1;
  console.log(
    `${(r.bytes / 1024).toFixed(1).padStart(7)} KB  ${r.start}-${r.end}  (${r.blocks.length} blocks)  escapes: ${r.escapes.length}  badReturns: ${r.badReturns}`
  );
  console.log(`          params: ${[...r.params].join(", ") || "(none beyond fn params)"}`);
  if (r.escapes.length) console.log(`          escaping: ${r.escapes.slice(0, 12).join(", ")}`);
  console.log(`          first: ${r.blocks[0].head.slice(0, 100)}`);
}
console.log(`\n${runs.length} runs, ${shown} over ${minRunKB} KB`);
