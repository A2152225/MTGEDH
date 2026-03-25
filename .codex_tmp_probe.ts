import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser";
const text = 'Whenever you discard a nonland card, you may cast it from your graveyard.';
const ir = parseOracleTextToIR(text, 'Oskar, Rubbish Reclaimer');
console.log(JSON.stringify(ir, null, 2));
