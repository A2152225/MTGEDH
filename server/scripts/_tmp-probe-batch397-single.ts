import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectUnknownIrGapsFromSteps, getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];
const names = ['Sicarian Infiltrator', 'Grim Draugr', 'Spry and Mighty', 'Spinal Parasite', 'Polukranos, Unchained', 'Mine Collapse', 'Steel Exemplar'];
for (const name of names) {
  const card = cards.find((c) => c.name === name);
  if (!card) continue;
  const parsed = parseOracleTextToIR(getCombinedOracleText(card), card.name);
  console.log(`\n=== ${name} ===`);
  for (const a of parsed.abilities || []) {
    const text = String(a.effectText || a.text || '').trim();
    if (!text) continue;
    const gaps = collectUnknownIrGapsFromSteps(a.steps || []);
    if (gaps.length === 0 && (a.steps || []).every((s) => s.kind !== 'unknown')) continue;
    console.log('type', a.type, 'gaps', gaps, 'text:', text.slice(0, 100));
    console.log(JSON.stringify(a.steps, null, 2)?.slice(0, 500));
  }
}
process.exit(0);
