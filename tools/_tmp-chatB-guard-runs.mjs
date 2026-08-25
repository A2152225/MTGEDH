// Chat B split helper: analyse a long guard-chain function so contiguous runs of
// `if (...) return [...]` statements can be hoisted into a sibling module without
// changing behaviour.
//
// For every top-level (indent 2) statement inside the function body it reports:
//   - line range and byte size
//   - identifiers it declares at statement level (shared locals for later statements)
//   - the outer locals it reads
//   - a classification of every `return` it can execute
//
// A run is only safe to hoist when every return in it is provably non-null, because the
// caller resumes the chain when the helper returns null. `return null` inside a run would
// change "stop here" into "keep trying later guards".

import fs from 'node:fs';

const [file, startArg, endArg] = process.argv.slice(2);
if (!file || !startArg || !endArg) {
  console.error('usage: node tools/_tmp-chatB-guard-runs.mjs <file> <fnStartLine> <fnEndLine> [--runs]');
  process.exit(1);
}
const fnStart = Number(startArg);
const fnEnd = Number(endArg);
const wantRuns = process.argv.includes('--runs');

const text = fs.readFileSync(file, 'utf8');
const allLines = text.split('\r\n');

// --- depth tracking that ignores strings, comments and regex literals -------------------
function scanLine(line, state) {
  let depth = state.depth;
  let inBlockComment = state.inBlockComment;
  let inTemplate = state.inTemplate;
  let i = 0;
  let prevMeaningful = state.prevMeaningful;

  while (i < line.length) {
    const c = line[i];
    const next = line[i + 1];

    if (inBlockComment) {
      if (c === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inTemplate) {
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        inTemplate = false;
        prevMeaningful = '`';
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') break;
    if (c === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      prevMeaningful = 'x';
      continue;
    }
    if (c === '/' && (prevMeaningful === '' || '(,=:[!&|?{};+*%~^<>'.includes(prevMeaningful))) {
      // regex literal
      i += 1;
      let inClass = false;
      while (i < line.length) {
        if (line[i] === '\\') {
          i += 2;
          continue;
        }
        if (line[i] === '[') inClass = true;
        else if (line[i] === ']') inClass = false;
        else if (line[i] === '/' && !inClass) {
          i += 1;
          break;
        }
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

// --- split the function body into top-level statements ----------------------------------
const bodyFirst = fnStart + 1;
const bodyLast = fnEnd - 1;

let state = { depth: 1, inBlockComment: false, inTemplate: false, prevMeaningful: '{' };
const statements = [];
let current = null;

for (let n = bodyFirst; n <= bodyLast; n += 1) {
  const line = allLines[n - 1];
  const trimmed = line.trim();
  if (state.depth === 1 && current === null && trimmed !== '') {
    current = { start: n, end: n };
  }
  state = scanLine(line, state);
  if (current) {
    current.end = n;
    if (state.depth === 1 && (trimmed.endsWith(';') || trimmed === '}' || trimmed.endsWith('}'))) {
      statements.push(current);
      current = null;
    }
  }
}
if (current) statements.push(current);

// --- classify each statement ------------------------------------------------------------
const declRe = /^\s*(const|let|var)\s+([A-Za-z0-9_$]+)/;
const declared = [];

// Every indent-2 declaration is a function-scope local regardless of how statement
// segmentation turned out. A hoisted run that reads one of these would either fail to compile
// or, worse, silently bind to a same-named module import, so they are collected by plain line
// scan and treated as hard blockers.
const functionLocals = [];
for (let n = bodyFirst; n <= bodyLast; n += 1) {
  const m = /^ {2}(?:const|let|var)\s+(?:\{\s*([^}]*)\}|([A-Za-z0-9_$]+))/.exec(allLines[n - 1]);
  if (!m) continue;
  const names = m[1]
    ? m[1].split(',').map((part) => part.split(':').pop().trim()).filter(Boolean)
    : [m[2]];
  for (const name of names) functionLocals.push({ name, line: n });
}
// Names the chain's prologue provides; a hoisted helper must receive or rebuild each one it reads.
// Chains differ, so the caller states which names exist (`--prologue raw,sequence`).
const prologueIdx = process.argv.indexOf('--prologue');
const PROLOGUE_NAMES =
  prologueIdx === -1
    ? ['raw', 'sequence', 'clauseBody', 'step', 'staticMetadata', 'temporaryMetadata']
    : process.argv[prologueIdx + 1].split(',').map((s) => s.trim()).filter(Boolean);
const PROLOGUE = new Set(PROLOGUE_NAMES);

function classifyReturn(expr) {
  const e = expr.trim();
  if (e === 'null' || e === 'null;') return 'NULL';
  if (e === 'undefined' || e === 'undefined;') return 'NULL';
  if (e.startsWith('[')) return 'array';
  if (/^(staticMetadata|temporaryMetadata)\s*\(/.test(e)) return 'metadata';
  if (/^\{/.test(e)) return 'object';
  return `expr:${e.slice(0, 46)}`;
}

const infos = statements.map((stmt) => {
  const body = allLines.slice(stmt.start - 1, stmt.end).join('\r\n');
  const bytes = Buffer.byteLength(body, 'utf8') + 2;
  // A leading comment block belongs to the statement it documents, so classification looks at
  // the first line that actually carries code.
  let headLine = stmt.start;
  while (headLine <= stmt.end && /^\s*\/\//.test(allLines[headLine - 1])) headLine += 1;
  const first = allLines[Math.min(headLine, stmt.end) - 1];
  const m = declRe.exec(first);
  const declares = m ? m[2] : null;
  if (declares) declared.push({ name: declares, line: stmt.start });

  // `if (x) return x;` is a guarded local: inside the guard x is truthy, so hoisting the pair
  // cannot turn a real match into a fallthrough.
  const guardedIdent = /^\s*if\s*\(\s*([A-Za-z0-9_$]+)\s*[)&]/.exec(first)?.[1] ?? null;
  const returns = [];
  // Anchored so the word "return" inside a regex literal (`/^return it to .../`) is not read as
  // a return statement.
  const returnRe = /^\s*return\b([^\n]*)/gm;
  let rm;
  while ((rm = returnRe.exec(body)) !== null) {
    const cls = classifyReturn(rm[1]);
    returns.push(guardedIdent && cls === `expr:${guardedIdent};` ? 'guarded-ident' : cls);
  }

  const idents = new Set(body.match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || []);
  const usesOuter = [
    ...new Set(
      [...declared, ...functionLocals]
        .filter((d) => d.line < stmt.start && idents.has(d.name))
        .map((d) => d.name)
    ),
  ];
  const usesPrologue = PROLOGUE_NAMES.filter((n) => idents.has(n));

  const kind = /^\s*if\s*\(/.test(first) ? 'if' : declares ? 'decl' : first.trim().split(/[\s(]/)[0];

  return { ...stmt, bytes, kind, declares, returns, usesOuter, usesPrologue, idents, first: first.trim().slice(0, 96) };
});

// Symbols declared at the parent's top level. A hoisted leaf may not touch these.
const parentTopLevel = new Set();
for (let n = 1; n <= allLines.length; n += 1) {
  if (n >= fnStart && n <= fnEnd) continue;
  const m = /^(?:export\s+)?(?:async\s+)?(?:function|const|let|var|class|enum)\s+([A-Za-z0-9_$]+)/.exec(allLines[n - 1]);
  if (m) parentTopLevel.add(m[1]);
}

// Reference span of every function-scope local, in statement indices. A run boundary must never
// cut one of these, otherwise the moved code loses (or silently rebinds) the name.
const localSpans = new Map();
for (const { name } of functionLocals) {
  if (PROLOGUE.has(name) || localSpans.has(name)) continue;
  let firstIdx = -1;
  let lastIdx = -1;
  infos.forEach((info, idx) => {
    if (!info.idents.has(name)) return;
    if (firstIdx === -1) firstIdx = idx;
    lastIdx = idx;
  });
  if (firstIdx !== -1) localSpans.set(name, { firstIdx, lastIdx });
}

// Shrink [i, j] until no local's span crosses either edge.
function clampRun(i, j) {
  let changed = true;
  while (changed && i <= j) {
    changed = false;
    for (const { firstIdx, lastIdx } of localSpans.values()) {
      if (firstIdx >= i && firstIdx <= j && lastIdx > j) {
        j = firstIdx - 1;
        changed = true;
      } else if (firstIdx < i && lastIdx >= i && lastIdx <= j) {
        i = lastIdx + 1;
        changed = true;
      } else if (firstIdx < i && lastIdx > j) {
        return null;
      }
    }
  }
  return i <= j ? [i, j] : null;
}

// A statement can join a run when it is a guard or a local declaration feeding one, and every
// return it can execute is provably non-null. `return null` would otherwise be downgraded into
// "keep trying later guards" once the run moves behind a call site.
function unsafeReason(info) {
  // Bare `{ ... }` scoping blocks are as safe as a guard: their locals cannot escape.
  if (info.kind !== 'if' && info.kind !== '{' && !info.declares) return `not-a-guard:${info.kind}`;
  // The chain prologue must stay in the parent; the helpers receive or rebuild it.
  if (info.declares && PROLOGUE.has(info.declares)) return `declares-prologue:${info.declares}`;
  // Call sites created by earlier hoists stay put so the parent still reads as the ordered chain.
  if (info.declares && /^hoisted/.test(info.declares)) return 'existing-hoist-call';
  // Referencing a symbol that lives at the parent's top level would make the leaf import its
  // own parent, which the split rules forbid.
  const parentSymbol = [...info.idents].find((n) => parentTopLevel.has(n));
  if (parentSymbol) return `parent-symbol:${parentSymbol}`;
  if (info.returns.some((r) => r === 'NULL')) return 'returns-null';
  const expr = info.returns.find((r) => r.startsWith('expr:'));
  if (expr) return expr;
  if (info.kind === 'if' && info.returns.length === 0) return 'no-return';
  return null;
}

function isSafe(info) {
  return unsafeReason(info) === null;
}

if (process.argv.includes('--cut-points')) {
  // Legal places to break the chain into a head function plus a tail helper: no function-scope
  // local declared before the cut may still be read at or after it.
  const spans = new Map();
  for (const { name } of functionLocals) {
    // Prologue values are handed to the tail helper as parameters, so they never block a cut.
    if (PROLOGUE.has(name) || spans.has(name)) continue;
    let firstIdx = -1;
    let lastIdx = -1;
    infos.forEach((info, idx) => {
      if (!info.idents.has(name)) return;
      if (firstIdx === -1) firstIdx = idx;
      lastIdx = idx;
    });
    if (firstIdx !== -1) spans.set(name, { firstIdx, lastIdx });
  }
  let acc = 0;
  const totalBytes = infos.reduce((a, s) => a + s.bytes, 0);
  infos.forEach((info, idx) => {
    acc += info.bytes;
    const legal = [...spans.values()].every(({ firstIdx, lastIdx }) => !(firstIdx <= idx && lastIdx > idx));
    if (!legal) return;
    const head = acc;
    const tail = totalBytes - acc;
    if (head < 8000 || tail < 8000) return;
    console.log(
      `cut after line ${String(info.end).padStart(6)}  head ${(head / 1024).toFixed(1).padStart(6)} KB  tail ${(tail / 1024).toFixed(1).padStart(6)} KB`
    );
  });
  process.exit(0);
}

if (process.argv.includes('--why')) {
  const tally = new Map();
  for (const info of infos) {
    const reason = unsafeReason(info);
    if (!reason) continue;
    const key = reason.startsWith('expr:') ? `expr-return` : reason.startsWith('uses-local:') ? 'uses-local' : reason;
    const cur = tally.get(key) || { bytes: 0, count: 0, samples: [] };
    cur.bytes += info.bytes;
    cur.count += 1;
    if (cur.samples.length < 3) cur.samples.push(`${info.start}: ${reason.slice(0, 60)}`);
    tally.set(key, cur);
  }
  const rows = [...tally.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  for (const [key, v] of rows) {
    console.log(`${(v.bytes / 1024).toFixed(1).padStart(8)} KB  ${String(v.count).padStart(4)}x  ${key}`);
    for (const s of v.samples) console.log(`             ${s}`);
  }
  process.exit(0);
}

if (!wantRuns) {
  for (const info of infos) {
    const flag = isSafe(info) ? 'SAFE' : '    ';
    const outer = info.usesOuter.filter((n) => !PROLOGUE.has(n));
    console.log(
      `${String(info.start).padStart(6)}-${String(info.end).padEnd(6)} ${String(info.bytes).padStart(7)}B ${flag} ${info.kind.padEnd(6)} ${
        outer.length ? `[outer: ${outer.slice(0, 4).join(',')}] ` : ''
      }${info.returns.filter((r) => r === 'NULL' || r.startsWith('expr:')).slice(0, 2).join(' | ')} ${info.first}`
    );
  }
  console.log(`\n${infos.length} top-level statements`);
} else {
  const budgetIdx0 = process.argv.indexOf('--budget');
  const runBudget = budgetIdx0 === -1 ? 30000 : Number(process.argv[budgetIdx0 + 1]);

  // A cut between statements k-1 and k is only legal when no local declared before k is still
  // referenced at or after k.
  const canCutBefore = (k) => {
    for (const { firstIdx, lastIdx } of localSpans.values()) {
      if (firstIdx < k && lastIdx >= k) return false;
    }
    return true;
  };

  // One safe run can be far larger than a single module should be, so it is chopped at the first
  // legal boundary past the budget.
  function splitRun(i, j) {
    const parts = [];
    let start = i;
    let bytes = 0;
    for (let k = i; k <= j; k += 1) {
      bytes += infos[k].bytes;
      if (bytes >= runBudget && k < j && canCutBefore(k + 1)) {
        parts.push([start, k]);
        start = k + 1;
        bytes = 0;
      }
    }
    if (start <= j) parts.push([start, j]);
    return parts;
  }

  const blocks = [];
  let blockStart = -1;
  infos.forEach((info, idx) => {
    if (isSafe(info)) {
      if (blockStart === -1) blockStart = idx;
    } else {
      if (blockStart !== -1) blocks.push([blockStart, idx - 1]);
      blockStart = -1;
    }
  });
  if (blockStart !== -1) blocks.push([blockStart, infos.length - 1]);

  const runs = [];
  for (const [rawI, rawJ] of blocks) {
    const clamped = clampRun(rawI, rawJ);
    if (!clamped) continue;
    const [i, j] = clamped;
    // A run that still ends on a dangling declaration would leave an unused local behind.
    let end = j;
    while (end >= i && infos[end].declares && !infos[end].returns.length) end -= 1;
    if (end < i) continue;
    for (const [si, sj] of splitRun(i, end)) {
      const slice = infos.slice(si, sj + 1);
      const uses = new Set();
      for (const info of slice) for (const u of info.usesPrologue) uses.add(u);
      runs.push({
        start: slice[0].start,
        end: slice[slice.length - 1].end,
        bytes: slice.reduce((a, s) => a + s.bytes, 0),
        count: slice.length,
        uses,
      });
    }
  }

  const minIdx2 = process.argv.indexOf('--min');
  const minRun = minIdx2 === -1 ? 1200 : Number(process.argv[minIdx2 + 1]);
  const kept = runs.filter((r) => r.bytes >= minRun);

  const planIdx = process.argv.indexOf('--plan');
  if (planIdx === -1) {
    let total = 0;
    for (const r of [...kept].sort((a, b) => b.bytes - a.bytes)) {
      total += r.bytes;
      console.log(
        `${String(r.start).padStart(6)}-${String(r.end).padEnd(6)} ${(r.bytes / 1024).toFixed(1).padStart(7)} KB  ${String(r.count).padStart(4)} guards  uses: ${[...r.uses].join(',') || '-'}`
      );
    }
    console.log(`\n${kept.length} runs >= ${minRun} B, ${(total / 1024).toFixed(1)} KB hoistable (of ${runs.length} runs total)`);
    process.exit(0);
  }

  const budgetIdx = process.argv.indexOf('--budget');
  const budget = budgetIdx === -1 ? 30000 : Number(process.argv[budgetIdx + 1]);
  const prefixIdx = process.argv.indexOf('--prefix');
  const prefix = prefixIdx === -1 ? 'parseResidualGuards' : process.argv[prefixIdx + 1];
  const outIdx = process.argv.indexOf('--out');
  const outBase = outIdx === -1 ? 'rules-engine/src/oracleIRParserPostprocessResidualGuards' : process.argv[outIdx + 1];

  const groups = [];
  let group = null;
  for (const r of kept) {
    if (!group || group.bytes + r.bytes > budget) {
      group = { chunks: [], bytes: 0 };
      groups.push(group);
    }
    group.chunks.push(r);
    group.bytes += r.bytes;
  }

  const plans = groups.map((g, gi) => ({
    parent: file,
    out: `${outBase}${gi + 1}.ts`,
    header: 'tools/_tmp-chatB-header.txt',
    chunks: g.chunks.map((r, ci) => {
      const uses = [...r.uses];
      const needsStep = uses.includes('step');
      const needsClause = uses.includes('clauseBody');
      const params = [
        "raw: string",
        "sequence: { sequence?: 'then' }",
        needsClause ? 'clauseBody: string' : null,
        needsStep ? 'step: OracleEffectStep' : null,
      ]
        .filter(Boolean)
        .join(', ');
      const args = ['raw', 'sequence', needsClause ? 'clauseBody' : null, needsStep ? 'step' : null]
        .filter(Boolean)
        .join(', ');
      return {
        start: r.start,
        end: r.end,
        name: `${prefix}${gi + 1}Run${ci + 1}`,
        prologue: ['staticMetadata', 'temporaryMetadata'].filter((n) => uses.includes(n)),
        params,
        args,
        bytes: r.bytes,
      };
    }),
  }));

  fs.writeFileSync(process.argv[planIdx + 1], JSON.stringify(plans, null, 2));
  for (const p of plans) {
    const bytes = p.chunks.reduce((a, c) => a + c.bytes, 0);
    console.log(`${p.out}  ${p.chunks.length} runs, ${(bytes / 1024).toFixed(1)} KB`);
  }
  console.log(`\nwrote ${plans.length} plans to ${process.argv[planIdx + 1]}`);
}
