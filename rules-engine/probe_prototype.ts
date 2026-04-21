import { parseOracleTextToIR } from './src/oracleIRParser.ts';
const cards = [
    { name: "Goring Warplow", text: "Deathtouch\nPrototype {1}{B} - 1/1 (If you cast this spell for {1}{B}, it’s a 1/1 creature and has that mana cost. It keeps its abilities and types.)" },
    { name: "Combat Thresher", text: "Double strike\nWhen Combat Thresher enters, draw a card.\nPrototype {1}{W} - 1/1 (If you cast this spell for {1}{W}, it’s a 1/1 creature and has that mana cost. It keeps its abilities and types.)" }
];
for (const card of cards) {
    console.log(`--- ${card.name} ---`);
    const ir = parseOracleTextToIR(card.text, card.name);
    console.log(JSON.stringify(ir, null, 2));
}
