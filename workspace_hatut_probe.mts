import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.ts';
const text = "When you cast this spell, copy it for each time you've cast your commander from the command zone this game.\nWhen this creature enters, destroy up to one target artifact or enchantment.";
const ir = parseOracleTextToIR(text, 'Hatut Zeraze Strike Force');
console.log(JSON.stringify(ir, null, 2));
