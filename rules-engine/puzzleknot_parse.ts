import { parseOracleTextToIR } from "./src/oracleIRParser";
const oracleText = "When this artifact enters, scry 2, then you get {E}{E}. (You get two energy counters. To scry 2, look at the top two cards of your library, then put any number of them on the bottom and the rest on top in any order.)\n{2}{U}, Sacrifice this artifact: Scry 2, then you get {E}{E}.";
const ir = (parseOracleTextToIR as any)(oracleText);
ir.abilities.forEach((ability: any, index: number) => {
  const text = ability.text || ability.effectText || "N/A";
  console.log("Ability " + (index + 1) + " [" + text + "]:");
  if (ability.steps) {
    ability.steps.forEach((step: any, sIdx: number) => {
      console.log("  Step " + (sIdx + 1) + ": " + JSON.stringify(step));
    });
  }
});
