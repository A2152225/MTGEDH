import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const oraclePath = path.resolve(__dirname, '../../oracle-cards.json');

function getCardOracle(name) {
  const raw = fs.readFileSync(oraclePath, 'utf8');
  const needle = `"name":"${name}"`;
  const idx = raw.indexOf(needle);
  if (idx < 0) return null;
  const slice = raw.slice(idx, idx + 12000);
  const oracleMatch = slice.match(/"oracle_text":"((?:\\.|[^"\\])*)"/);
  if (!oracleMatch) return null;
  return oracleMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
}

function unknowns(text, cardName) {
  const ir = parseOracleTextToIR(text, cardName);
  const out = [];
  function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) { for (const e of v) walk(e); return; }
    if (v.kind === 'unknown') out.push(v.raw);
    for (const [k, c] of Object.entries(v)) {
      if (k === 'raw' || k === 'text' || k === 'effectText') continue;
      walk(c);
    }
  }
  for (const a of ir.abilities || []) for (const s of a.steps || []) walk(s);
  return out;
}

const fury = getCardOracle('Director Nick Fury');
console.log('Fury oracle:', fury);
const attackLine = fury?.split('\n').find((l) => /attacks/i.test(l));
console.log('attack line:', attackLine);
if (attackLine) console.log('unknowns:', unknowns(attackLine, 'Director Nick Fury'));

const dazzle = getCardOracle('Dazzling Sphinx');
const dmgLine = dazzle?.split('\n').find((l) => /combat damage/i.test(l));
console.log('\nDazzle line:', dmgLine);
if (dmgLine) console.log('unknowns:', unknowns(dmgLine, 'Dazzling Sphinx'));

console.log('\nlife probe:', unknowns('you gain life equal to its mana value.', 'Test'));
