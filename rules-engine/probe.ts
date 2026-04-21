import { parseOracleTextToIR } from "./src/oracleIRParser.ts";
const cards = [
    { name: "Songbirds Blessing", text: "Whenever enchanted creature attacks, reveal cards from the top of your library until you reveal an Aura card. You may put that card onto the battlefield. If you dont, put it into your hand. Put the rest on the bottom of your library in a random order." },
    { name: "Garruks Harbinger", text: "Whenever this creature deals combat damage to a player or planeswalker, look at that many cards from the top of your library. You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order." },
    { name: "Industrial Advancement", text: "At the beginning of your end step, you may sacrifice a creature. If you do, look at the top X cards of your library, where X is that creatures mana value. You may put a creature card from among them onto the battlefield. Put the rest on the bottom of your library in a random order." },
    { name: "The Key to the Vault", text: "Whenever equipped creature deals combat damage to a player, look at that many cards from the top of your library. You may exile a nonland card from among them. Put the rest on the bottom of your library in a random order. You may cast the exiled card without paying its mana cost." },
    { name: "Doomskar Warrior", text: "Whenever this creature deals combat damage to a player or battle, look at that many cards from the top of your library. You may reveal a creature or land card from among them and put it into your hand. Put the rest on the bottom of your library in a random order." }
];

cards.forEach(card => {
    console.log(`--- ${card.name} ---`);
    const ir = parseOracleTextToIR(card.text);
    ir.abilities.forEach((ability: any, i: number) => {
        console.log(`  Ability ${i}:`);
        ability.steps.forEach((step: any, j: number) => {
            console.log(`    Step ${j}: [${step.kind}] "${step.raw}"`);
        });
    });
});
