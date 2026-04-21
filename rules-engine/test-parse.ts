import { parseOracleTextToIR } from './src/oracleIRParser.ts';
const text = "As Kindred Discovery enters, choose a creature type.";
const ir = parseOracleTextToIR(text, "Kindred Discovery");
console.log(JSON.stringify(ir, null, 2));
