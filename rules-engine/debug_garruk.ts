import { parseOracleTextToIR } from "./src/oracleIRParser";
const ir = parseOracleTextToIR(
  "Whenever this creature deals combat damage to a player or planeswalker, look at that many cards from the top of your library. You may reveal a creature card or Garruk planeswalker card from among them and put it into your hand. Put the rest on the bottom of your library in a random order.",
  "Garruk Harbinger"
);
console.log(JSON.stringify(ir.abilities.flatMap(a => a.steps.map(s => s.raw)), null, 2));
