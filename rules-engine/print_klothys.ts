import { parseOracleTextToIR } from "./src/oracleIRParser.js";
const text = "Exile target card from a graveyard. If it was a land card, add {R} or {G}. Otherwise, you gain 2 life and this permanent deals 2 damage to each opponent.";
const ir = parseOracleTextToIR(text, "Klothys, God of Destiny");
console.log(JSON.stringify(ir.abilities, null, 2));
