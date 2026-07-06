import { parseBareTriggerEffectFragmentSteps } from '../../rules-engine/src/oracleIRParserPostprocess.js';

const text =
  'you may tap any number of untapped creatures you control. this creature gets +1/+1 until end of turn for each creature tapped this way.';

console.log(JSON.stringify(parseBareTriggerEffectFragmentSteps(text), null, 2));
process.exit(0);
