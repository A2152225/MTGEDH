import { parseOracleTextToIR } from "./src/oracleIRParser";

const texts = [
  "Whenever you cast a spell, you win the game.",
  "At the beginning of your upkeep, you win the game."
];

texts.forEach(text => {
  const parsed = parseOracleTextToIR(text);
  console.log(`Text: "${text}"`);
  console.log("Full JSON: " + JSON.stringify(parsed, null, 2));
  console.log("---");
});