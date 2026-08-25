// Chat B split helper: resolve "Cannot find name 'X'" in freshly extracted modules.
//
// Runs the rules-engine typecheck, collects TS2304 names per file, resolves each name to the
// module that exports it (preferring the module the parent already imports it from), and merges
// the missing bindings into the target file's import block.
//
// Refuses to add an import that would point a leaf back at its own parent, since that is the
// cycle the split rules forbid.

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const PARENT = 'rules-engine/src/oracleIRParserPostprocess.ts';
const SRC_DIR = 'rules-engine/src';
const apply = !process.argv.includes('--dry');

let tscOutput = '';
try {
  tscOutput = execSync('npx tsc -p tsconfig.typecheck.json --noEmit', {
    cwd: 'rules-engine',
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} catch (err) {
  tscOutput = `${err.stdout || ''}${err.stderr || ''}`;
}

const missing = new Map();
for (const line of tscOutput.split(/\r?\n/)) {
  const m = /^(src\/[^(]+)\(\d+,\d+\): error TS2304: Cannot find name '([^']+)'/.exec(line);
  if (!m) continue;
  const file = `rules-engine/${m[1]}`;
  if (!missing.has(file)) missing.set(file, new Set());
  missing.get(file).add(m[2]);
}

if (missing.size === 0) {
  console.log('no TS2304 names to resolve');
  process.exit(0);
}

// Where does the parent already get each name from?
const parentText = fs.readFileSync(PARENT, 'utf8');
const parentImports = new Map();
const importRe = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*'([^']+)'/g;
let im;
while ((im = importRe.exec(parentText)) !== null) {
  for (const rawName of im[1].split(',')) {
    const name = rawName.trim().split(/\s+as\s+/).pop().trim();
    if (name) parentImports.set(name, im[2]);
  }
}

// Fallback: which sibling exports the name?
const siblingExports = new Map();
for (const entry of fs.readdirSync(SRC_DIR)) {
  if (!entry.endsWith('.ts')) continue;
  const modulePath = `./${entry.replace(/\.ts$/, '')}`;
  const text = fs.readFileSync(path.join(SRC_DIR, entry), 'utf8');
  const declared = text.match(/^export\s+(?:async\s+)?(?:function|const|class|enum|type|interface)\s+([A-Za-z0-9_$]+)/gm) || [];
  for (const d of declared) {
    const name = d.split(/\s+/).pop();
    if (!siblingExports.has(name)) siblingExports.set(name, modulePath);
  }
  const blocks = text.match(/^export\s*\{[^}]*\}\s*;?\s*$/gm) || [];
  for (const block of blocks) {
    for (const rawName of block.replace(/^export\s*\{/, '').replace(/\}\s*;?\s*$/, '').split(',')) {
      const name = rawName.trim().split(/\s+as\s+/).pop().trim();
      if (name && !siblingExports.has(name)) siblingExports.set(name, modulePath);
    }
  }
}

const parentModule = `./${path.basename(PARENT, '.ts')}`;

for (const [file, names] of missing) {
  const additions = new Map();
  const unresolved = [];
  for (const name of names) {
    const from = parentImports.get(name) || siblingExports.get(name);
    if (!from || from === parentModule) {
      unresolved.push(`${name}${from === parentModule ? ' (would import the parent)' : ''}`);
      continue;
    }
    if (!additions.has(from)) additions.set(from, new Set());
    additions.get(from).add(name);
  }

  let text = fs.readFileSync(file, 'utf8');
  const added = [];
  for (const [from, importNames] of additions) {
    const existing = new RegExp(`^import \\{([^}]*)\\} from '${from.replace(/[.*+?^$()|[\\]\\\\]/g, '\\\\$&')}';$`, 'm');
    const match = existing.exec(text);
    if (match) {
      const current = new Set(match[1].split(',').map((s) => s.trim()).filter(Boolean));
      for (const n of importNames) current.add(n);
      text = text.replace(match[0], `import { ${[...current].sort().join(', ')} } from '${from}';`);
    } else {
      // Recomputed from the current text: an earlier addition in this loop already shifted lines.
      const rebuilt = text.split('\r\n');
      const lastImport = rebuilt.reduce((acc, l, i) => (/^import .* from '.*';$/.test(l) ? i : acc), -1);
      const fresh = `import { ${[...importNames].sort().join(', ')} } from '${from}';`;
      rebuilt.splice(lastImport === -1 ? 0 : lastImport + 1, 0, fresh);
      text = rebuilt.join('\r\n');
    }
    added.push(`${from}: ${[...importNames].join(', ')}`);
  }

  console.log(`\n${file}`);
  for (const a of added) console.log(`  + ${a}`);
  for (const u of unresolved) console.log(`  ! unresolved ${u}`);
  if (apply && added.length) fs.writeFileSync(file, text);
}
console.log(apply ? '\napplied' : '\ndry run');
