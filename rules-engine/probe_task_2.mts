import { parseOracleTextToIR } from "./src/oracleIRParser.js";
const text = "Manifest dread. (Look at the top two cards of your library. Put one onto the battlefield face down as a 2/2 creature and the other into your graveyard. Turn it face up any time for its mana cost if it's a creature card.)";
console.log(JSON.stringify(parseOracleTextToIR(text, "test"), null, 2));
