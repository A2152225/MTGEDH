import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

for (const text of [
  'then that player shuffles',
  'they lose 3 life',
  'Its owner creates a 1/1 white Spirit creature token with flying',
  'that player mills three cards',
]) {
  const steps = parseOracleTextToIR(text, 'Probe').abilities.flatMap((a) => a.steps);
  console.log('\n', text, JSON.stringify(steps, null, 2));
}
process.exit(0);
