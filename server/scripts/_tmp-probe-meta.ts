import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

for (const s of ['seek a nonland card', 'dredge 2', 'augment {3}{w}', 'that player loses the game', 'Whenever this creature attacks, augment {3}{w}']) {
  const ir = parseOracleTextToIR(s, 'Test');
  console.log('\n===', s, '===');
  console.log(JSON.stringify(ir.abilities, null, 2));
}
