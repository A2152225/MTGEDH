#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

function lines(cmd, args) {
  return spawnSync(process.execPath, [cmd, ...args], { encoding: 'utf8' })
    .stdout.trim().split('\n').filter(Boolean);
}

const [, , startArg, endArg, kind, symbol, importsFile, ...descParts] = process.argv;
const start = Number(startArg);
const end = Number(endArg);
const desc = descParts.join(' ') || kind;
const imports = fs.readFileSync(importsFile, 'utf8').trim();
const decls = lines('tools/_extract_bw/list-range-decls.mjs', ['client/src/App.tsx', String(start), String(end)]);
const used = lines('tools/_extract_bw/used-bindings-fixed.mjs', ['client/src/App.tsx', String(start), String(end)]);
const declSet = new Set(decls);
const passed = used.filter((n) => !declSet.has(n));

const header = `// Origin parent: client/src/App.tsx
// Cluster moved: ${desc}
// Public entry symbols: ${symbol}.
// Leaf must not import App.tsx or App-handlers/index.ts.

${imports}

export function ${symbol}(p: Record<string, any>) {
  const {
${passed.map((n) => `    ${n},`).join('\n')}
  } = p;
`;
  const footer = `
  return {
${decls.map((n) => `    ${n},`).join('\n')}
  };
}
`;
  const replacement = `  const {
${decls.map((n) => `    ${n},`).join('\n')}
  } = ${symbol}({
${passed.map((n) => `    ${n},`).join('\n')}
  });
`;
  fs.writeFileSync(`tools/_extract_bw/${kind}.header.ts`, header);
  fs.writeFileSync(`tools/_extract_bw/${kind}.footer.ts`, footer);
  fs.writeFileSync(`tools/_extract_bw/${kind}.replacement.ts`, replacement);
  console.log(`${kind}: ${passed.length} deps, ${decls.length} returns`);
