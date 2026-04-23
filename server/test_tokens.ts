import { detectSpellCastTriggers } from "./src/state/modules/triggers/spell-cast";
const cards = [
  { oracle_text: "Flash\nFlying\nWhenever you cast a spell from exile, create a 1/1 white Ally creature token." },
  { oracle_text: "Whenever you cast a spell from your graveyard, create a 1/1 blue Bird creature token with flying and \"This token can block only creatures with flying.\"" }
];
for (const card of cards) {
  const triggers = detectSpellCastTriggers(card, {});
  for (const t of triggers) {
    if (t.createsToken) console.log(JSON.stringify(t.tokenDetails));
  }
}
