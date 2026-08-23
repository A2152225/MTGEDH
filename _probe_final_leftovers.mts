import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.js';
const cards = [
  { name: 'Brain Gorgers', clause: 'any player may sacrifice a creature of their choice. If a player does, counter Brain Gorgers' },
  { name: 'Dash Hopes', clause: 'any player may pay 5 life. If a player does, counter Dash Hopes' },
  { name: 'Eldrazi Obligator', clause: 'you may pay {1}{C}. If you do, gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn' },
  { name: 'Mutated Cultist', clause: 'remove all counters from up to one target permanent or opponent. The next spell you cast this turn costs {1} less to cast for each counter removed this way' },
];
for (const c of cards) {
  const ir = parseOracleTextToIR(`When you cast this spell, ${c.clause}.`, c.name);
  const steps = ir.abilities.flatMap((a: any) => a.steps || []);
  console.log('\n====', c.name, '====');
  console.log(JSON.stringify(steps, null, 2).slice(0, 1800));
}
