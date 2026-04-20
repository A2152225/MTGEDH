import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser";

const text = "Madness {U} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)\nDraw a card.";
const cardName = "Obsessive Search";

const result = parseOracleTextToIR(text, cardName);
console.log(JSON.stringify(result, null, 2));
