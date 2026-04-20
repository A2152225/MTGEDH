import { parseOracleTextToIR } from "./src/oracleIRParser";

const oracleText = "When this artifact enters, scry 2, then you get {E}{E}. (You get two energy counters. To scry 2, look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)\n{2}{U}, Sacrifice this artifact: Scry 2, then you get {E}{E}.";

const ir = parseOracleTextToIR(oracleText);

ir.abilities.forEach((ability, index) => {
  console.log(`Ability ${index + 1}:`);
  ability.steps.forEach(step => {
    console.log(`  Kind: ${step.kind}, Raw: ${step.rawValue}`);
  });
});