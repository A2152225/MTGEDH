import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

function dump(name: string) {
  const card = cards.find((c) => c.name === name);
  if (!card) return console.log('missing', name);
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, name);
  console.log('\n########', name, '########');
  console.log(JSON.stringify(parsed.abilities, null, 2));
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, name);
    const rec = dryRunOracleSteps(steps, card, hasUnknownIRSteps(text, name), { typeLine: card.type_line });
    if (rec.status !== 'fully_applied' && rec.status !== 'choice_required') {
      console.log('DRY', text.slice(0, 100), rec.status, rec.reasonCodes);
    }
  }
}

await loadEffectIrParser();
for (const n of [
  'Jailbreak',
  'Stolen Uniform',
  'The War in Heaven',
  'Witness the Future',
  "Eventide's Shadow",
  'Ugin, the Ineffable',
  "Pharika's Spawn",
]) dump(n);
