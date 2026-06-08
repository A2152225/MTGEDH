import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const ir = parseOracleTextToIR('you gain life equal to its mana value.', 'Test');
console.log(JSON.stringify(ir.abilities[0]?.steps, null, 2));

const ir2 = parseOracleTextToIR('gain life equal to its mana value.', 'Test');
console.log('no you:', JSON.stringify(ir2.abilities[0]?.steps, null, 2));
