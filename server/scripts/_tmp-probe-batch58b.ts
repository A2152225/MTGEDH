import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { getCombinedOracleText, loadEffectIrParser } from './trigger-coverage-audit.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(__dirname, '../../oracle-cards.json'), 'utf8')) as any[];

for (const name of ['Deathgorge Scavenger', 'Brain Gorgers', 'Mirkwood Elk', 'Archfiend of Spite']) {
  const card = cards.find((c) => c.name === name);
  if (!card) continue;
  const oracle = getCombinedOracleText(card);
  console.log('\n====', name, '====');
  for (const t of parseTriggeredAbilitiesFromText(oracle, name)) {
    const steps = collectStepsFromIrText(t.effect, name);
    const irGaps: string[] = [];
    const record = dryRunOracleSteps(steps, card, irGaps);
    console.log('condition:', t.triggerCondition);
    console.log('effect:', t.effect.slice(0, 140));
    console.log('status:', record.status, 'gaps:', record.reasonCodes);
    console.log('steps:', steps.map((s) => s.kind).join(' -> '));
  }
}
