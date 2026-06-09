import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { hasUnknownIRSteps } from './trigger-coverage-audit.ts';

const text =
  "The next time a source of your choice would deal damage to you this turn, prevent that damage. Exile cards from the top of your library equal to the damage prevented this way.";
const steps = collectStepsFromIrText(text, 'Bone Mask');
console.log(JSON.stringify(steps, null, 2));
const rec = dryRunOracleSteps(steps, 'Bone Mask', hasUnknownIRSteps(text, 'Bone Mask'));
console.log(rec.status, rec.reasonCodes);
