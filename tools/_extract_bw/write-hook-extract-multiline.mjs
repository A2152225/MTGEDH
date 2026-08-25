#!/usr/bin/env node
/**
 * Like write-hook-extract.mjs but also collects multi-line `const { ... } =` names.
 */
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
const fileLines = fs.readFileSync('client/src/App.tsx', 'utf8').split(/\r?\n/);
const decls = [];
let inDestructure = false;
for (let i = start - 1; i < end && i < fileLines.length; i += 1) {
  const line = fileLines[i];
  if (!inDestructure && /^  const \{/.test(line)) {
    if (/\} = /.test(line)) {
      const inner = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
      for (const part of inner.split(',')) {
        const name = part.trim();
        if (name) decls.push(name);
      }
      continue;
    }
    inDestructure = true;
    continue;
  }
  if (inDestructure) {
    if (/^  \} = /.test(line)) {
      inDestructure = false;
      continue;
    }
    const m = /^    ([A-Za-z_$][\w$]*),?\s*$/.exec(line);
    if (m) decls.push(m[1]);
    continue;
  }
  const state = /^  const \[([^\]]+)\]\s*=/.exec(line);
  if (state) {
    for (const raw of state[1].split(',')) {
      const name = raw.trim();
      if (name) decls.push(name);
    }
    continue;
  }
  const single = /^  const ([A-Za-z_$][\w$]*)\s*=/.exec(line);
  if (single) decls.push(single[1]);
}

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
  console.error('returns:\n' + decls.join('\n'));
