import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { collectStepsFromIrText } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';
import { splitIntoClauses } from '../../rules-engine/src/oracleIRParserUtils.js';

await loadEffectIrParser();
const oracle = 'Enchant player\nWhenever enchanted player is dealt damage, they lose half their life, rounded up.';
console.log('clauses:', splitIntoClauses('they lose half their life, rounded up.'));
for (const t of parseTriggeredAbilitiesFromText(oracle, 'Grievous Wound')) {
  console.log('effect:', JSON.stringify(t.effect));
  console.log('steps:', collectStepsFromIrText(t.effect, 'Grievous Wound'));
  console.log('irGaps:', hasUnknownIRSteps(t.effect, 'Grievous Wound'));
}
