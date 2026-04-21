import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';
const samples = [
    "Whenever enchanted creature attacks, reveal cards from the top of your library until you reveal an Aura card. You may put that card onto the battlefield. If you don't, put it into your hand. Put the rest on the bottom of your library in a random order.",
    "Whenever you cast a legendary spell from your hand, exile cards from the top of your library until you exile a legendary nonland card with lesser mana value. You may cast that card without paying its mana cost. Put the rest on the bottom of your library in a random order.",
    "At the beginning of your upkeep, put a time counter on Wilfred Mott. Then look at the top X cards of your library, where X is the number of time counters on Wilfred Mott. You may put a nonland permanent card with mana value 3 or less from among them onto the battlefield. Put the rest on the bottom of your library in a random order."
];
samples.forEach(text => {
    console.log('--- TEXT ---');
    console.log(text);
    const result = parseOracleTextToIR(text);
    console.log('--- IR STEPS ---');
    console.log(JSON.stringify(result.abilities[0].steps, null, 2));
});
