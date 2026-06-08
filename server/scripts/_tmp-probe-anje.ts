import { parseQuantity } from '../../rules-engine/src/oracleIRParserUtils.js';
import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.js';

const amount = 'draw a card.") {2}, Sacrifice another creature or a Blood token: Each opponent';
console.log('parseQuantity:', parseQuantity(amount));

const ir = parseOracleTextToIR(
  'sacrifice this token: draw a card.") {2}, Sacrifice another creature or a Blood token: Each opponent loses 2 life and you gain 2 life.',
  'Anje'
);
console.log(JSON.stringify(ir.abilities, null, 2));
