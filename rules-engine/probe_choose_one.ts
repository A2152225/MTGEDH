const cards = [
    {
        "name":  "Inscription of Insight",
        "text":  "Kicker {2}{U}{U}\nChoose one. If this spell was kicked, choose any number instead.\nâ€¢ Return up to two target creatures to their owners\u0027 hands.\nâ€¢ Scry 2, then draw two cards.\nâ€¢ Target player creates an X/X blue Illusion creature token, where X is the number of cards in their hand."
    },
    {
        "name":  "Catch-Up Mechanic",
        "text":  "When this creature enters, choose one. If an opponent has at least 5 more life than you, choose any number insteadâ€”\nâ€¢ Put two +1/+1 counters on another target creature or Vehicle.\nâ€¢ Return target artifact card from your graveyard to your hand.\nâ€¢ Look at the top five cards of your library. Reveal an artifact card from among them and put it into your hand. Put the rest on the bottom in a random order."
    },
    {
        "name":  "Prophetic Titan",
        "text":  "Delirium â€” When this creature enters, choose one. If there are four or more card types among cards in your graveyard, choose both instead.\nâ€¢ This creature deals 4 damage to any target.\nâ€¢ Look at the top four cards of your library. Put one of them into your hand and the rest on the bottom of your library in a random order."
    },
    {
        "name":  "Aetheric Amplifier",
        "text":  "{T}: Add one mana of any color.\n{4}, {T}: Choose one. Activate only as a sorcery.\nâ€¢ Double the number of each kind of counter on target permanent.\nâ€¢ Double the number of each kind of counter you have."
    },
    {
        "name":  "Moxite Refinery",
        "text":  "{2}, {T}, Remove X counters from an artifact or creature you control: Choose one. Activate only as a sorcery.\nâ€¢ Put X charge counters on target artifact.\nâ€¢ Put X +1/+1 counters on target creature."
    }
];
import { parseOracleTextToIR } from "./src/oracleIRParser.ts"; cards.forEach(card => { console.log("--- " + card.name + " ---"); const ir = parseOracleTextToIR(card.text, card.name); ir.abilities.forEach(ability => { if (ability.text.includes("Choose one")) { console.log("Ability: " + ability.text); ability.steps.forEach(step => { console.log("  Kind: " + step.kind + " | Raw: " + step.raw); }); } }); });
