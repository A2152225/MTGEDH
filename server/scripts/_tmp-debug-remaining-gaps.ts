/**
 * Debug remaining gap cards — run: npx tsx server/scripts/_tmp-debug-remaining-gaps.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { getCombinedOracleText } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

function dump(name: string): void {
  const card = cards.find((c) => c.name === name);
  if (!card) return;
  const parsed = parseOracleTextToIR(getCombinedOracleText(card), name);
  console.log(`\n=== ${name} ===`);
  console.log(getCombinedOracleText(card));
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    console.log('\nability:', text.slice(0, 120));
    console.log(JSON.stringify(ability.steps, null, 2));
  }
}

for (const name of [
  'Summon: Magus Sisters',
  'Froghemoth',
  'Brain Pry',
  "Pharika's Spawn",
  'Jaya Ballard',
]) {
  dump(name);
}
