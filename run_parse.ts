import { parseOracleTextToIR } from "./rules-engine/src/oracleIRParser";

const texts = [
  "Madness {U} (If you discard this card, discard it into exile. When you do, cast it for its madness cost or put it into your graveyard.)\nDraw a card.",
  "Proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)\nDraw a card.",
  "Destroy target creature, then proliferate. (Choose any number of permanents and/or players, then give each another counter of each kind already there.)"
];

for (const text of texts) {
  const result = parseOracleTextToIR(text);
  console.log("--- TEXT ---");
  console.log(text);
  console.log("--- ABILITIES ---");
  const output = result.abilities.map(a => ({
    type: a.type,
    keywords: a.keywords || [],
    steps: (a as any).steps?.map((s: any) => ({ raw: s.raw })) || []
  }));
  console.log(JSON.stringify(output, null, 2));
}
