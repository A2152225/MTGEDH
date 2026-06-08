import { parseOracleTextToIR } from '../../rules-engine/src/oracleIRParser.ts';

const text = "that player exiles cards from the top of their library until they exile an instant or sorcery card. you may cast that card without paying its mana cost.";
const ir = parseOracleTextToIR(text, 'Dazzling Sphinx');
console.log(JSON.stringify(ir.abilities[0]?.steps, null, 2));
