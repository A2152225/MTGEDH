import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser.ts";
const c = (n, t) => ({ name: n, text: t });
const cards = [
  c("Songbirds Blessing", "Enchant creature\nWhenever enchanted creature attacks, reveal cards from the top of your library until you reveal an Aura card. You may put that card onto the battlefield. If you dont, put it into your hand. Put the rest on the bottom of your library in a random order."),
  c("Garruks Harbinger", "Hexproof from black\nWhenever this creature deals combat damage to a player or planeswalker, look at that many cards from the top of your library. You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order."),
  c("Industrial Advancement", "At the beginning of your end step, you may sacrifice a creature. If you do, look at the top X cards of your library, where X is that creatures mana value. You may put a creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order."),
  c("The Key to the Vault", "Whenever equipped creature deals combat damage to a player, look at that many cards from the top of your library. You may exile a nonland card from among them. Put the rest on the bottom of your library in a random order. You may cast the exiled card without paying its mana cost.\nEquip {2}{U}"),
  c("Doomskar Warrior", "Backup 1\nTrample\nWhenever this creature deals combat damage to a player or battle, look at that many cards from the top of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.")
];
cards.forEach(card => {
  console.log("--- " + card.name + " ---");
  const ir = parseOracleTextToIR(card.text, card.name);
  ir.abilities.forEach((ability, i) => {
    if (ability.trigger || ability.condition) {
       console.log("  Ability " + i + ":");
       ability.steps.forEach((step, j) => {
         console.log("    Step " + j + ": " + JSON.stringify(step));
       });
    }
  });
});
