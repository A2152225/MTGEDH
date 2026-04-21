import fs from "node:fs";
import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser.ts";
for (const [name, text] of [
  ["Leyline of Sanctity", "If this card is in your opening hand, you may begin the game with it on the battlefield.\nYou have hexproof. (You can't be the target of spells or abilities your opponents control.)"],
  ["Teferi's Realm", "All nontoken permanents of that type phase out. (While they're phased out, they're treated as though they don't exist. Each one phases in before its controller untaps during their next untap step.)"]
] as const) {
  const ir = parseOracleTextToIR(text, name);
  console.log(`--- ${name} ---`);
  console.log(JSON.stringify(ir.abilities, null, 2));
  console.log(JSON.stringify(ir.keywords));
}
