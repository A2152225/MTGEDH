import { parseOracleTextToIR } from "./src/oracleIRParser";

const texts = [
  "When this creature enters, if you control an Assassin, you win the game.",
  "When this creature enters, you win the game if you control an Assassin."
];

texts.forEach(text => {
  const parsed = parseOracleTextToIR(text);
  console.log(`Text: "${text}"`);
  console.log("Full JSON: " + JSON.stringify(parsed, null, 2));
  console.log("---");
});