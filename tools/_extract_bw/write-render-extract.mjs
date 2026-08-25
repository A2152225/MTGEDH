#!/usr/bin/env node
/**
 * Build header/footer/replacement fixtures for a renderApp* JSX extract.
 * Usage:
 *   node tools/_extract_bw/write-render-extract.mjs <start> <end> <kind> <symbol> <desc>
 */
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const [, , startArg, endArg, kind, symbol, ...descParts] = process.argv;
const start = Number(startArg);
const end = Number(endArg);
const desc = descParts.join(' ') || kind;

const used = spawnSync(process.execPath, [
  'tools/_extract_bw/used-bindings-fixed.mjs',
  'client/src/App.tsx',
  String(start),
  String(end),
], { encoding: 'utf8' }).stdout.trim().split('\n').filter((n) => n && n !== 'socket');

const depsOut = spawnSync(process.execPath, [
  'tools/ts-cluster-deps.mjs',
  'client/src/App.tsx',
  String(start),
  String(end),
], { encoding: 'utf8' }).stdout;

const importMap = new Map();
for (const line of depsOut.split('\n')) {
  const m = /^\s+(\S+)\s+x\d+\s+from\s+(\S+)(?:\s+\(type\))?/.exec(line);
  if (!m) continue;
  const name = m[1];
  let spec = m[2];
  if (spec.startsWith('./App-handlers/')) continue;
  if (spec.startsWith('./')) spec = `.${spec}`;
  else if (spec.startsWith('../../shared/')) spec = `../${spec}`;
  if (name === 'socket') spec = '../socket';
  if (!importMap.has(spec)) importMap.set(spec, { names: new Set(), types: new Set(), isTypeLine: line.includes('(type)') });
  const rec = importMap.get(spec);
  if (line.includes('(type)')) rec.types.add(name);
  else rec.names.add(name);
}

const defaultFromSpec = new Map([
  ['../components/CommanderConfirmModal', 'CommanderConfirmModal'],
  ['../components/GameList', 'GameList'],
  ['../components/NameInUseModal', 'NameInUseModal'],
]);

const importLines = [];
if ([...used].some((n) => n === 'useMemo') || /useMemo\(/.test(fs.readFileSync('client/src/App.tsx', 'utf8').split(/\r?\n/).slice(start - 1, end).join('\n'))) {
  importLines.push('import React, { useMemo } from "react";');
}
for (const [spec, rec] of importMap) {
  const def = defaultFromSpec.get(spec);
  const values = [...rec.names].filter((n) => n !== def);
  const types = [...rec.types];
  if (def) {
    importLines.push(`import ${def} from "${spec}";`);
  }
  if (values.length) {
    importLines.push(`import { ${values.join(', ')} } from "${spec}";`);
  } else if (types.length && !values.length && !def) {
    importLines.push(`import type { ${types.join(', ')} } from "${spec}";`);
  }
  if (types.length && values.length) {
    // already imported values from same spec; types may be inline
  }
}
if (!importMap.has('../socket')) {
  const body = fs.readFileSync('client/src/App.tsx', 'utf8').split(/\r?\n/).slice(start - 1, end).join('\n');
  if (/\bsocket\b/.test(body)) importLines.unshift('import { socket } from "../socket";');
}

const uniqueImports = [...new Set(importLines)];

const header = `// Origin parent: client/src/App.tsx
// Cluster moved: ${desc}
// Public entry symbols: ${symbol}.
// Leaf must not import App.tsx or App-handlers/index.ts.

${uniqueImports.join('\n')}

export function ${symbol}(p: Record<string, any>) {
  const {
${used.map((n) => `    ${n},`).join('\n')}
  } = p;
  return (
    <>
`;
  const footer = `    </>
  );
}
`;
  const replacement = `      {${symbol}({
${used.map((n) => `        ${n},`).join('\n')}
      })}
`;
  fs.writeFileSync(`tools/_extract_bw/${kind}.header.ts`, header);
  fs.writeFileSync(`tools/_extract_bw/${kind}.footer.ts`, footer);
  fs.writeFileSync(`tools/_extract_bw/${kind}.replacement.ts`, replacement);
  console.log(`${kind}: ${used.length} props, ${uniqueImports.length} imports`);
