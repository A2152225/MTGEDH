import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser";
const samples = [
  ["Aang, Airbending Master", "When this creature enters, airbend another target creature."],
  ["Appa", "When Appa enters, airbend any number of other target nonland permanents you control. (Exile them. While each one is exiled, its owner may cast it for {2} rather than its mana cost.)"],
  ["Airbending", "Airbend target creature you control."],
];
for (const [name, text] of samples) {
  console.log(`=== ${name} ===`);
  console.log(JSON.stringify(parseOracleTextToIR(text, name), null, 2));
}
