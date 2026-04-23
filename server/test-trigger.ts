import { detectSpellCastTriggers } from "./src/state/modules/triggered-abilities";

const oracleText = "Flash\nFlying\nWhenever you cast a spell from exile, create a 1/1 white Ally creature token.";
const card = {
    name: "Pia Nalaar, Consul of Revival",
    oracle_text: oracleText
};
const permanent = {
    id: "perm-1",
    controller: "player-1"
};

const triggers = detectSpellCastTriggers(card, permanent);
console.log(JSON.stringify(triggers, null, 2));
console.log(`Count: ${triggers.length}`);
