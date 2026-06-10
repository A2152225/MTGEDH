import { loadEffectIrParser } from './trigger-coverage-audit.ts';
import { collectStepsFromIrText, dryRunOracleSteps } from './executor-coverage-audit.ts';
import { parseMoveZoneCountTargetBattlefieldBounce } from '../../rules-engine/src/oracleIRExecutorZoneOps.ts';

await loadEffectIrParser();
const text = "Return one or two target creatures to their owner's hand.";
const steps = collectStepsFromIrText(text, 'Command of Unsummoning');
console.log('steps', JSON.stringify(steps, null, 2));
console.log('bounce parse', parseMoveZoneCountTargetBattlefieldBounce({ kind: 'raw', text: String((steps[0] as any)?.what?.text || '') }));
const rec = dryRunOracleSteps(steps, 'Command of Unsummoning', []);
console.log(rec.status, rec.reasonCodes);
