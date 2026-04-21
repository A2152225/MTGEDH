import { parseOracleTextToIR } from './src/oracleIRParser.ts';
const text = 'When this creature dies, earthbend 2. (Target land you control becomes a 0/0 creature with haste that\s still a land. Put two +1/+1 counters on it. When it dies or is exiled, return it to the battlefield tapped.)';
const ir = parseOracleTextToIR(text, 'Earthbend Probe');
console.log(JSON.stringify(ir, null, 2));
