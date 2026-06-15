import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];
for (const name of ['Spry and Mighty', 'Spinal Parasite', 'Sicarian Infiltrator']) {
  const card = cards.find((c) => c.name === name && c.layout !== 'token') || cards.find((c) => c.name === name);
  console.log('\n', name, card?.layout);
  const parsed = parseOracleTextToIR(getCombinedOracleText(card), card.name);
  for (const a of parsed.abilities || []) {
    const text = String(a.effectText || a.text || '');
    if (name === 'Spry and Mighty' && !/Choose exactly two/.test(text)) continue;
    if (name === 'Spinal Parasite' && !/Remove a counter/.test(text)) continue;
    if (name === 'Sicarian Infiltrator' && !/draw a card/i.test(text)) continue;
    console.log(JSON.stringify(a.steps, null, 2));
  }
}
process.exit(0);
