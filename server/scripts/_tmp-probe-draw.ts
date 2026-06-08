import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

const samples = [
  'that player draws an additional card',
  'draw two additional cards',
  "draw a card at the beginning of the next turn's upkeep",
];

for (const s of samples) {
  const ir = parseOracleTextToIR(s, 'Test');
  console.log('\n===', s, '===');
  console.log(JSON.stringify(ir.abilities, null, 2));
}
