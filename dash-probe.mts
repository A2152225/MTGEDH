import { parseOracleTextToIR } from "./src/oracleIRParser.ts";
const dashLine = "Dash {1}{R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)";
const lightningText = "{R}: This creature gets +1/+0 until end of turn.\nDash {R} (You may cast this spell for its dash cost. If you do, it gains haste, and it's returned from the battlefield to its owner's hand at the beginning of the next end step.)";
const cases = [
    { name: "Bare Dash Line", text: dashLine, cardName: "Test Card" },
    { name: "Lightning Berserker Full Text", text: lightningText, cardName: "Lightning Berserker" }
];
cases.forEach(c => {
    const ir = parseOracleTextToIR(c.text, c.cardName);
    console.warn(`--- Case: ${c.name} ---`);
    console.warn(`Keywords: ${JSON.stringify(ir.keywords || [])}`);
    console.warn(`Abilities Count: ${ir.abilities.length}`);
    ir.abilities.forEach((a, i) => {
        console.warn(`Ability ${i}: type=${a.type}, text="${a.text}", effectText="${a.effectText}"`);
        if (a.steps) {
            a.steps.forEach((s, si) => {
                console.warn(`  Step ${si}: kind=${s.kind}, raw="${s.raw}"`);
            });
        }
    });
    console.warn("");
});
