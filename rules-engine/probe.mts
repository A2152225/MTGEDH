import { parseOracleTextToIR } from "./src/oracleIRParser.js";
const cases = [
    "Mutate {2}{G} (If you cast this spell for its mutate cost, put it over or under target non-Human creature you own. They mutate into the creature on top plus all abilities from under it.)",
    "Each player who controls the most creatures investigates. Then destroy all creatures. (To investigate, create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")",
    "Whenever a creature attacks you or a planeswalker you control, investigate. (Create a Clue token. It's an artifact with \"{2}, Sacrifice this token: Draw a card.\")"
];
cases.forEach(text => {
    console.log("--- TEXT ---");
    console.log(text);
    console.log("--- IR ---");
    console.log(JSON.stringify(parseOracleTextToIR(text, "test"), null, 2));
});
