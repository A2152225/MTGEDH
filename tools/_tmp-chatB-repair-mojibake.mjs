// Chat B: replace the repeated CP1252/UTF-8 mojibake seed in oracleIRParser.ts with the
// apostrophe/bullet it stands for. The seed is one character that ballooned to ~2KB.
// This is an encoding restore, not a parser rewrite. Dry-run unless --apply.
//
// Usage: node tools/_tmp-chatB-repair-mojibake.mjs [--apply]
import fs from 'node:fs';
import crypto from 'node:crypto';

const file = 'rules-engine/src/oracleIRParser.ts';
const apply = process.argv.includes('--apply');
const buf = fs.readFileSync(file);
const text = buf.toString('utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);

const runRe = /[^\x00-\x7F]{16,}/gu;
const seeds = new Map();

lines.forEach((line, i) => {
  runRe.lastIndex = 0;
  let m;
  while ((m = runRe.exec(line)) !== null) {
    const run = m[0];
    const hash = crypto.createHash('sha1').update(run).digest('hex').slice(0, 10);
    const rec = seeds.get(hash) || {
      hash,
      count: 0,
      chars: run.length,
      bytes: Buffer.byteLength(run, 'utf8'),
      run,
      lines: [],
      before: line.slice(Math.max(0, m.index - 24), m.index),
      after: line.slice(m.index + run.length, m.index + run.length + 24),
    };
    rec.count += 1;
    if (rec.lines.length < 8) rec.lines.push(i + 1);
    seeds.set(hash, rec);
  }
});

const sorted = [...seeds.values()].sort((a, b) => b.count * b.bytes - a.count * a.bytes);
console.log(`distinct seeds: ${sorted.length}`);
for (const s of sorted) {
  console.log(
    `  ${s.hash} x${s.count} ${s.chars} chars ${s.bytes}B  lines ${s.lines.join(',')}`
  );
  console.log(`    ctx: ${JSON.stringify(s.before)}<RUN>${JSON.stringify(s.after)}`);
}

// Dominant seed is the apostrophe class filler. Smaller leftover runs get the same
// replacement when they sit next to ' or s (possessive), else U+2022 when next to a bullet.
const replacements = new Map();
for (const s of sorted) {
  const ctx = `${s.before}<RUN>${s.after}`;
  if (/don\[<RUN>'?]t/i.test(ctx) || /\[<RUN>'?\]/.test(ctx) || /(?:'s|\[<RUN>\]s)/.test(ctx) || /player\[<RUN>'?\]/.test(ctx) || /<RUN>'/.test(ctx) || /'s\|\[<RUN>\]/.test(ctx)) {
    replacements.set(s.hash, '\u2019');
  } else if (/\\u2022<RUN>/.test(ctx) || /[\u2022]<RUN>/.test(ctx)) {
    replacements.set(s.hash, '');
  } else if (s.chars >= 1000) {
    replacements.set(s.hash, '\u2019');
  } else {
    replacements.set(s.hash, '\u2019');
  }
}

let next = text;
let replacedRuns = 0;
let saved = 0;
for (const s of sorted) {
  const repl = replacements.get(s.hash);
  if (repl === undefined) continue;
  const pieces = next.split(s.run);
  const hits = pieces.length - 1;
  if (hits === 0) continue;
  next = pieces.join(repl);
  replacedRuns += hits;
  saved += hits * (s.bytes - Buffer.byteLength(repl, 'utf8'));
  console.log(`replace ${s.hash} -> ${JSON.stringify(repl)}  x${hits}`);
}

console.log(`would replace ${replacedRuns} runs, save ~${saved} B (${(saved / 1024).toFixed(1)} KB)`);
console.log(`new size would be ${Buffer.byteLength(next, 'utf8')} B`);

if (apply) {
  const out = next.includes('\r\n') || eol === '\r\n' ? next : next;
  // Preserve original line endings: we split on generic newlines when reading via toString
  // but `text` still has the original endings; replacements never insert newlines.
  fs.writeFileSync(file, Buffer.from(next, 'utf8'));
  console.log('applied');
}
