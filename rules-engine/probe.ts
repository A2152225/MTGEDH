import { parseOracleTextToIR } from "./src/oracleIRParser.ts";
const cases = [
  "Whenever this creature becomes tapped, create a Lander token. (It\u0027s an artifact with \"{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\")",
  "Create a Lander token. Then you may sacrifice an artifact. When you do, Lithobraking deals 2 damage to each creature. (A Lander token is an artifact with \"{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\")",
  "When this creature enters, create a Lander token. At the beginning of the end step on your next turn, sacrifice that token. (It\u0027s an artifact with \"{2}, {T}, Sacrifice this token: Search your library for a basic land card, put it onto the battlefield tapped, then shuffle.\")"
];
cases.forEach((text, i) => {
  const ir = parseOracleTextToIR(text, "Card " + (i+1));
  process.stdout.write(`\n--- Case ${i+1} ---\n`);
  ir.abilities.forEach(a => {
    process.stdout.write(`Ability Type: ${a.type}\n`);
    process.stdout.write(`Text: ${a.text}\n`);
    a.steps.forEach(s => {
      process.stdout.write(`  Step Kind: ${s.kind}, Raw: "${s.raw}"\n`);
    });
  });
});
