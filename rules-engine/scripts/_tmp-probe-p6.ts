import { parseOracleTextToIR } from '../src/oracleIRParser.ts';

const cases: [string, string][] = [
  ['Fatal Fissure', 'When that creature dies this turn, you earthbend 4'],
  ['Blossoming Calm', 'You gain hexproof until your next turn'],
  ['The Unagi of Kyoshi Island', 'Ward-Waterbend {4}'],
  ['Aegis Angel', "A creature with indestructible can't be destroyed by damage.)"],
  [
    'Spry and Mighty',
    "You draw X cards and the chosen creatures get +X/+X and gain trample until end of turn, where X is the difference between the chosen creatures' powers",
  ],
];

for (const [name, text] of cases) {
  const ir = parseOracleTextToIR(text, name);
  console.log(`\n=== ${name} ===`);
  for (const ability of ir.abilities) {
    console.log('type', ability.type, 'text', ability.text?.slice(0, 60));
    for (const step of ability.steps || []) {
      console.log(' ', step.kind, step.raw?.slice?.(0, 80) || step);
    }
  }
}
