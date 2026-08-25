// Chat B split helper: build a new module's header from a cluster-deps report, so the import
// block is copied mechanically instead of retyped.
//
//   node tools/_tmp-chatB-cluster-deps.mjs <parent> <start> <end> > tools/_tmp-chatB-deps.txt
//   node tools/_tmp-chatB-make-header.mjs "<comment body>" ["<entry1>,<entry2>"]

import fs from 'node:fs';

const [body, entries] = process.argv.slice(2);
if (!body) {
  console.error('usage: node tools/_tmp-chatB-make-header.mjs "<comment body>" ["<entry1>,<entry2>"]');
  process.exit(1);
}

const report = fs.readFileSync('tools/_tmp-chatB-deps.txt', 'utf8').split(/\r?\n/);
const at = report.findIndex((l) => l.startsWith('IMPORTS the cluster needs:'));
if (at === -1) {
  console.error('deps report has no IMPORTS section');
  process.exit(1);
}
const imports = report.slice(at + 1).filter((l) => l.startsWith('import '));

// Wrap long named-import lists so the header stays readable.
const wrapped = imports.map((line) => {
  if (line.length <= 110) return line;
  const m = /^import (type )?\{(.*)\} from '(.*)';$/.exec(line);
  if (!m) return line;
  const names = m[2].split(',').map((s) => s.trim()).filter(Boolean);
  return `import ${m[1] ?? ''}{\n${names.map((n) => `  ${n},`).join('\n')}\n} from '${m[3]}';`;
});

const entryLines = entries
  ? `//\n// Public entry points:\n${entries.split(',').map((e) => `//   ${e.trim()}`).join('\n')}\n`
  : '';

const origin = process.argv.includes('--parser')
  ? 'rules-engine/src/oracleIRParser.ts'
  : 'rules-engine/src/oracleIRParserPostprocess.ts';
const header = `// Extracted from ${origin} (chat B 40KB split campaign).
//
${body
  .split('\n')
  .map((l) => `// ${l}`.trimEnd())
  .join('\n')}
${entryLines}
${wrapped.join('\n')}

`;

fs.writeFileSync('tools/_tmp-chatB-header.txt', header);
console.log(header);
