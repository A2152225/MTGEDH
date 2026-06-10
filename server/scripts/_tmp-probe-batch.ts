import fs from 'node:fs';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];
const names = [
  'Healing Technique',
  'Elixir of Immortality',
  'Asmodeus the Archfiend',
  'Domineering Will',
  'Infernal Reckoning',
  'Deadeye Tracker',
  'Random Encounter',
  "Waterbender's Restoration",
];

for (const name of names) {
  const card = cards.find((c: any) => c.name === name);
  const oracle = getCombinedOracleText(card);
  const parsed = parseOracleTextToIR(oracle, card.name);
  console.log('\n===', name, '===');
  for (const ability of parsed.abilities || []) {
    const text = String(ability.effectText || ability.text || '').trim();
    if (!text) continue;
    const steps = collectStepsFromIrText(text, card.name);
    const rec = dryRunOracleSteps(steps, card, [], { typeLine: card.type_line });
    if (rec.status === 'fully_applied') continue;
    console.log('STATUS', rec.status, rec.reasonCodes, rec.stepKinds);
    console.log('ABILITY', text.slice(0, 200));
    console.log('steps', JSON.stringify(steps, null, 2).slice(0, 2200));
    break;
  }
}
