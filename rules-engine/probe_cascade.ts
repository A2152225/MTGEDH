import { parseOracleTextToIR } from './src/oracleIRParser.ts';
const text = "Cascade, cascade (When you cast this spell, exile cards from the top of your library until you exile a nonland card that costs less. You may cast it without paying its mana cost. Put the exiled cards on the bottom in a random order. Then do it again.)";
const ir = parseOracleTextToIR(text, "Call Forth the Tempest");
console.log(JSON.stringify(ir, null, 2));
