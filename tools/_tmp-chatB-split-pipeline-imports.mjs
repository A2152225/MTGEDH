// Move the giant postprocess named-import from parseOracleTextToIR into a re-export sibling
// so the pipeline file stays under 40KB. Names and order are copied verbatim.
import fs from 'node:fs';

const srcPath = 'rules-engine/src/oracleIRParserParseOracleTextToIR.ts';
const outPath = 'rules-engine/src/oracleIRParserParseOracleTextToIRPostprocess.ts';
const text = fs.readFileSync(srcPath, 'utf8');
const eol = text.includes('\r\n') ? '\r\n' : '\n';
const lines = text.split(/\r?\n/);

const start = lines.findIndex((l) => l === 'import {');
const end = lines.findIndex((l, i) => i > start && l === "} from './oracleIRParserPostprocess';");
if (start < 0 || end < 0) {
  console.error('could not find postprocess import block', start, end);
  process.exit(1);
}

const names = lines.slice(start + 1, end);
const header = [
  '// Extracted from rules-engine/src/oracleIRParserParseOracleTextToIR.ts (chat B 40KB split campaign).',
  '//',
  '// Re-export hop for the postprocess helpers used by parseOracleTextToIR, so that module',
  '// stays under the 40KB ceiling. Names and order match the original import list.',
  '',
  'export {',
  ...names,
  "} from './oracleIRParserPostprocess';",
  '',
];

const replacement = [
  'import {',
  ...names,
  "} from './oracleIRParserParseOracleTextToIRPostprocess';",
];

const next = [...lines.slice(0, start), ...replacement, ...lines.slice(end + 1)];
fs.writeFileSync(outPath, header.join(eol));
fs.writeFileSync(srcPath, next.join(eol));
console.log(`wrote ${outPath} ${fs.statSync(outPath).size} B`);
console.log(`pipeline now ${fs.statSync(srcPath).size} B`);
