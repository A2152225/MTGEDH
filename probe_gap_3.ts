import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';
const text1 = "When Seedship Agrarian enters the battlefield, you may search your library for a basic land card, reveal it, put it into your hand, then shuffle. (Then shuffle your library.)";
console.log('--- Seedship Agrarian ---');
console.log(JSON.stringify(parseOracleTextToIR(text1), null, 2));
