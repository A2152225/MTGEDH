import { dryRunOracleSteps, collectStepsFromIrText, shouldDeclineOptionalStepsForAudit } from './executor-coverage-audit.ts';
import { getCombinedOracleText, hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import fs from 'node:fs';

await loadEffectIrParser();
const cards = JSON.parse(fs.readFileSync(new URL('../../oracle-cards.json', import.meta.url), 'utf8')) as any[];

for (const cardName of ['Maulfist Squad', 'Risen Reef', 'Wooden Stake', 'Molderhulk']) {
  const card = cards.find((c: any) => c.name === cardName);
  const oracle = getCombinedOracleText(card);
  for (const trigger of parseTriggeredAbilitiesFromText(oracle, card.name)) {
    const effect = String(trigger.effect || '').trim();
    const steps = collectStepsFromIrText(effect, card.name);
    const irGaps = hasUnknownIRSteps(effect, card.name);
    const status = dryRunOracleSteps(steps, card, irGaps);
    if (status.status !== 'fully_applied') {
      console.log(cardName, status, 'decline', shouldDeclineOptionalStepsForAudit(steps));
    } else {
      console.log(cardName, 'fully_applied');
    }
  }
}
