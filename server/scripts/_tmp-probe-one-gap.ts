import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';
import { hasUnknownIRSteps, loadEffectIrParser } from './trigger-coverage-audit.ts';

await loadEffectIrParser();

const text =
  "This turn, when target creature you control attacks and isn't blocked, you may gain life equal to its power. If you do, it assigns no combat damage this turn.";
console.log(hasUnknownIRSteps(text, "Delif's Cone"));
console.log(JSON.stringify(parseOracleTextToIR(text, "Delif's Cone").abilities?.[0]?.steps, null, 2));
