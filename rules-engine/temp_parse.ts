import { parseOracleTextToIR } from './src/oracleIRParser';
const oracleText = 'Partner with Proud Mentor (When this creature enters, target player may put Proud Mentor into their hand from their library, then shuffle.)';
const result = parseOracleTextToIR(oracleText);
console.log(JSON.stringify(result, null, 2));
