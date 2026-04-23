import { detectSpellCastTriggers } from "./src/state/modules/triggered-abilities";

const oracleText = "Flash\nFlying\nWhenever you cast a spell from exile, create a 1/1 white Ally creature token.";
const card = { oracle_text: oracleText, name: "Test Card" };
const triggers = detectSpellCastTriggers(card, null);

console.log(JSON.stringify(triggers, null, 2));
