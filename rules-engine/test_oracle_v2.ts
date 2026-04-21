import { parseOracleTextToIR } from "./src/oracleIRParser";

const texts = [
  "If they were attacked this turn by an Assassin you controlled, you win the game.",
  "If you have exactly 1 life, you win the game.",
  "If this enchantment has twenty or more growth counters on it, you win the game.",
  "If you control four or more Demons with different names, you win the game."
];

texts.forEach(text => {
  const parsed = parseOracleTextToIR(text);
  console.log(`Text: "${text}"`);
  console.log("Full JSON: " + JSON.stringify(parsed, null, 2));
  console.log("---");
});