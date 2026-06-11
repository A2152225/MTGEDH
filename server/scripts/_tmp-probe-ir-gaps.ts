import fs from 'node:fs';
import path from 'node:path';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import {
  getCombinedOracleText,
  hasUnknownIRSteps,
  isCommanderLegalCard,
  isEligible,
  loadEffectIrParser,
} from './trigger-coverage-audit.ts';

const repoRoot = path.resolve(import.meta.dirname, '../..');
await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(path.join(repoRoot, 'oracle-cards.json'), 'utf8')) as any[];

for (const card of cards) {
  if (!isEligible(card) || !isCommanderLegalCard(card)) continue;
  const oracle = getCombinedOracleText(card);
  if (!oracle) continue;
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    if (!effect) continue;
    const irGaps = hasUnknownIRSteps(effect, card.name);
    if (irGaps.length === 0) continue;
    const steps = collectStepsFromIrText(effect, card.name);
    const record = dryRunOracleSteps(steps, card, irGaps, { typeLine: card.type_line });
    if (record.status !== 'ir_gap') continue;
    console.log('\n===', card.name, '|', trigger.event, '===');
    console.log('effect:', effect.slice(0, 220));
    console.log('irGaps:', irGaps);
    console.log(
      'steps:',
      steps.map((s: any) => `${s.kind}:${String(s.raw || '').slice(0, 70)}`)
    );
  }
}
