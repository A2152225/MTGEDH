import { parseOracleTextToIR } from "./src/oracleIRParser";
const ir = parseOracleTextToIR(
  "Whenever enchanted creature attacks, reveal cards from the top of your library until you reveal an Aura card. You may put that card onto the battlefield. If you don't, put it into your hand. Put the rest on the bottom of your library in a random order.",
  "Songbirds Blessing"
);
console.log(JSON.stringify(ir.abilities.flatMap(a => a.steps.map(s => s.raw)), null, 2));
