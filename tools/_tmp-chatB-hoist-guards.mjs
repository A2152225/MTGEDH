// Chat B split helper: order-preserving hoist of guard runs out of a long
// `if (...) return [...]` chain into a sibling module.
//
// Each chunk in the plan becomes an exported helper whose body is the moved bytes verbatim,
// wrapped in a signature plus copies of the chain's prologue closures. The parent keeps a
// call site in the exact position the run occupied, so guard order is unchanged:
//
//     const x = helper(raw, sequence);
//     if (x) return x;
//
// Moved bytes are never re-encoded, and the script refuses to write unless the parent's
// untouched regions still reassemble to the original byte-for-byte.
//
// Plan file (JSON):
//   { "parent": "...", "out": "...", "header": "tools/....txt",
//     "chunks": [ { "start": 9610, "end": 10248, "name": "parseFoo",
//                   "prologue": ["staticMetadata", "temporaryMetadata"] } ] }

import fs from 'node:fs';

const planPath = process.argv[2];
const dry = process.argv.includes('--dry');
if (!planPath) {
  console.error('usage: node tools/_tmp-chatB-hoist-guards.mjs <plan.json> [--dry]');
  process.exit(1);
}
const parsed = JSON.parse(fs.readFileSync(planPath, 'utf8'));
const indexArg = process.argv.indexOf('--index');
const plan = Array.isArray(parsed)
  ? parsed[indexArg === -1 ? 0 : Number(process.argv[indexArg + 1])]
  : parsed;
if (!plan) {
  console.error('no plan at the requested index');
  process.exit(1);
}

const PROLOGUE_SOURCE = {
  staticMetadata: [
    "  const staticMetadata = (target: string, effectText: string): readonly OracleEffectStep[] => [{",
    "    kind: 'grant_static_ability',",
    '    target: parseObjectSelector(target),',
    '    effectText: [effectText],',
    "    duration: 'static',",
    '    raw,',
    '    ...sequence,',
    '  } as unknown as OracleEffectStep];',
    '',
  ].join('\r\n'),
  temporaryMetadata: [
    "  const temporaryMetadata = (target: string, effectText: string, duration: 'this_turn' | 'end_of_turn' | 'until_next_turn' = 'this_turn'): readonly OracleEffectStep[] => [{",
    "    kind: 'grant_temporary_ability',",
    '    target: parseObjectSelector(target),',
    '    effectText: [effectText],',
    '    duration,',
    '    raw,',
    '    ...sequence,',
    '  } as unknown as OracleEffectStep];',
    '',
  ].join('\r\n'),
};

const original = fs.readFileSync(plan.parent);
const lineStarts = [0];
for (let i = 0; i < original.length; i += 1) {
  if (original[i] === 0x0a) lineStarts.push(i + 1);
}
const totalLines = lineStarts.length;
const originalLines = original.toString('utf8').split('\r\n');
const lineAt = (n) => originalLines[n - 1] ?? '';

const chunks = [...plan.chunks].sort((a, b) => a.start - b.start);

// --- boundary guard: inner-chain runs start at an indent-2 `if (` and end at `  }` --------
const problems = [];
let prevEnd = 0;
for (const chunk of chunks) {
  const { start, end, name } = chunk;
  if (!(start > prevEnd)) problems.push(`${name}: range ${start}-${end} overlaps the previous chunk`);
  prevEnd = end;
  if (start < 1 || end < start || end > totalLines) {
    problems.push(`${name}: range ${start}-${end} out of bounds`);
    continue;
  }
  // A run starts on a guard, on the local declaration feeding it, or on the comment documenting it.
  if (!/^ {2}(?:if \(|const |let |var |\/\/)/.test(lineAt(start))) {
    problems.push(`${name}: line ${start} does not start an indent-2 statement: "${lineAt(start)}"`);
  }
  const endLine = lineAt(end);
  if (endLine !== '  }' && !/^ {2}\S.*;$/.test(endLine)) {
    problems.push(`${name}: line ${end} does not close a statement: "${endLine}"`);
  }
  const prev = lineAt(start - 1).trim();
  if (prev !== '' && !/[;}]$/.test(prev)) problems.push(`${name}: line ${start - 1} is a continuation: "${prev}"`);
  const next = lineAt(end + 1).trim();
  if (next !== '' && !/^(if|const|let|return|\/\/)/.test(next)) {
    problems.push(`${name}: line ${end + 1} after the run looks unexpected: "${next}"`);
  }
}
if (problems.length > 0) {
  console.error('BOUNDARY GUARD FAILED - refusing to slice:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// --- assemble ---------------------------------------------------------------------------
const parentPieces = [];
const helperTexts = [];
let cursor = 0;
let movedBytes = 0;

for (const chunk of chunks) {
  const sliceStart = lineStarts[chunk.start - 1];
  const sliceEnd = chunk.end < totalLines ? lineStarts[chunk.end] : original.length;
  parentPieces.push(original.subarray(cursor, sliceStart));

  const moved = original.subarray(sliceStart, sliceEnd);
  movedBytes += moved.length;
  cursor = sliceEnd;

  const params = chunk.params || "raw: string, sequence: { sequence?: 'then' }";
  const args = chunk.args || 'raw, sequence';
  const prologue = (chunk.prologue || []).map((key) => {
    const source = PROLOGUE_SOURCE[key];
    if (!source) {
      console.error(`unknown prologue closure "${key}"`);
      process.exit(1);
    }
    return source;
  });

  const signature = `export function ${chunk.name}(\r\n  ${params}\r\n): readonly OracleEffectStep[] | null {\r\n`;
  helperTexts.push(
    Buffer.concat([
      Buffer.from(signature, 'utf8'),
      Buffer.from(prologue.join('\r\n'), 'utf8'),
      Buffer.from(prologue.length ? '\r\n' : '', 'utf8'),
      moved,
      Buffer.from('  return null;\r\n}\r\n\r\n', 'utf8'),
    ])
  );

  const local = `${chunk.name.replace(/^parse/, 'hoisted')}`;
  parentPieces.push(
    Buffer.from(`  const ${local} = ${chunk.name}(${args});\r\n  if (${local}) return ${local};\r\n`, 'utf8')
  );
}
parentPieces.push(original.subarray(cursor));

// Identity: the untouched parent regions plus the moved regions must rebuild the original.
const untouched = [];
let verifyCursor = 0;
for (const chunk of chunks) {
  const sliceStart = lineStarts[chunk.start - 1];
  const sliceEnd = chunk.end < totalLines ? lineStarts[chunk.end] : original.length;
  untouched.push(original.subarray(verifyCursor, sliceStart));
  untouched.push(original.subarray(sliceStart, sliceEnd));
  verifyCursor = sliceEnd;
}
untouched.push(original.subarray(verifyCursor));
if (!Buffer.concat(untouched).equals(original)) {
  console.error('IDENTITY CHECK FAILED - refusing to write');
  process.exit(1);
}

const headerSource = plan.headerText ?? fs.readFileSync(plan.header, 'utf8');
const header = Buffer.from(headerSource.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
const newFile = Buffer.concat([header, ...helperTexts]);
const newParent = Buffer.concat(parentPieces);

console.log(`parent      : ${plan.parent}`);
console.log(`chunks      : ${chunks.length}, ${movedBytes} B moved (${(movedBytes / 1024).toFixed(1)} KB)`);
console.log(`new file    : ${plan.out}  ${newFile.length} B (${(newFile.length / 1024).toFixed(1)} KB)`);
console.log(`parent after: ${newParent.length} B (${(newParent.length / 1024).toFixed(1)} KB), was ${original.length} B`);
console.log('identity    : OK (untouched + moved === original)');

if (dry) {
  console.log('dry run - nothing written');
  process.exit(0);
}
if (fs.existsSync(plan.out)) {
  console.error(`refusing to overwrite existing ${plan.out}`);
  process.exit(1);
}

fs.writeFileSync(plan.out, newFile);
fs.writeFileSync(plan.parent, newParent);
console.log('written');

function show(label, buffer, fromLine, toLine) {
  const rows = buffer.toString('utf8').split('\n');
  console.log(`\n--- ${label} (lines ${fromLine}-${toLine}) ---`);
  for (let i = fromLine; i <= Math.min(toLine, rows.length); i += 1) {
    const row = rows[i - 1] ?? '';
    const eol = row.endsWith('\r') ? 'CRLF' : i < rows.length ? ' LF!' : '  --';
    console.log(`${String(i).padStart(6)} ${eol} |${row.replace(/\r$/, '')}`);
  }
}

const firstCall = chunks[0].start;
show('parent first call site', newParent, Math.max(1, firstCall - 3), firstCall + 3);
const headerLines = header.toString('utf8').split('\n').length;
show('new file first helper', newFile, headerLines - 1, headerLines + 14);
const newFileLines = newFile.toString('utf8').split('\n').length;
show('new file tail', newFile, Math.max(1, newFileLines - 6), newFileLines);
