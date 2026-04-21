import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser';
const texts = [
  "Whenever this creature becomes tapped, create a Lander token. (It's an artifact with \"{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\")",
  "Create a Lander token. Then you may sacrifice an artifact. When you do, Lithobraking deals 2 damage to each creature. (A Lander token is an artifact with \"{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\")",
  "Trample\nWhen this creature enters, create a Lander token. (It's an artifact with \"{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\")\nLandfall — Whenever a land you control enters, creatures you control get +1/+1 and gain vigilance and haste until end of turn."
];
texts.forEach((text, idx) => {
  console.log(`--- TEXT ${idx} ---`);
  console.log(text);
  const result = parseOracleTextToIR(text);
  console.log('--- RESULT ---');
  result.abilities.forEach((ability, i) => {
    ability.steps?.forEach((step, j) => {
      if (step.raw && (step.raw.includes('shuffle') || step.raw.includes('Lander'))) {
         console.log(`Ability ${i+1} Step ${j+1}: ${JSON.stringify(step.raw)}`);
         console.log(`  Structure: ${JSON.stringify(step).substring(0, 100)}...`);
      }
    });
  });
});
