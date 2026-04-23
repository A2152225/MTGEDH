import { detectSpellCastTriggers } from "./src/state/modules/triggered-abilities";

const oracleText = "Whenever you cast a Merfolk spell, create a 1/1 blue Elemental creature token.";
const card = { oracle_text: oracleText, name: "Deeproot Waters" };
const triggers = detectSpellCastTriggers(card, null);

console.log(JSON.stringify(triggers, null, 2));
