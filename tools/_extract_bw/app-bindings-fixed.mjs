#!/usr/bin/env node
/**
 * App() bindings collector that treats single-line `const { ... } =` as closed.
 * Inventory only — never rewrites the parent.
 */
import fs from 'node:fs';

const file = process.argv[2] || 'client/src/App.tsx';
const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
const names = new Set();
let inHookDestructure = false;

for (const line of lines) {
  if (/^  const \{/.test(line)) {
    if (/\} = /.test(line)) {
      const inner = line.slice(line.indexOf('{') + 1, line.lastIndexOf('}'));
      for (const part of inner.split(',')) {
        const token = part.trim();
        if (!token) continue;
        // Keep the local binding (`width: viewportWidth` → viewportWidth).
        const local = token.includes(':') ? token.split(':').pop().trim() : token;
        const name = local.replace(/^.*\s+/, '').trim();
        if (name && /^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
      }
      continue;
    }
    inHookDestructure = true;
    continue;
  }
  if (inHookDestructure) {
    if (/^  \} = /.test(line)) {
      inHookDestructure = false;
      continue;
    }
    const m = /^    ([A-Za-z_$][\w$]*),?\s*$/.exec(line);
    if (m && !/^(if|for|const|let|return|else|typeof|void)$/.test(m[1])) names.add(m[1]);
    continue;
  }
  const state = /^  const \[([^\]]+)\]\s*=/.exec(line);
  if (state) {
    for (const raw of state[1].split(',')) {
      const name = raw.trim();
      if (name) names.add(name);
    }
    continue;
  }
  const single = /^  const ([A-Za-z_$][\w$]*)\s*=/.exec(line);
  if (single) names.add(single[1]);
  const fn = /^  function ([A-Za-z_$][\w$]*)/.exec(line);
  if (fn) names.add(fn[1]);
}

console.log([...names].sort().join('\n'));
console.error(`${names.size} bindings`);
