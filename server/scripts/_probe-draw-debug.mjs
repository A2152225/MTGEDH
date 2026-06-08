import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const ir = parseOracleTextToIR('draw a card', 'Kindred Discovery');
console.log(JSON.stringify(ir.abilities[0].steps[0], null, 2));

const ir2 = parseOracleTextToIR('draw a card');
console.log('without name:', JSON.stringify(ir2.abilities[0].steps[0], null, 2));
