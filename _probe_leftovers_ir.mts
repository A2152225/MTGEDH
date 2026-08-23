import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.js';
import { isTriggerEffectFullyIrWired } from './server/src/state/modules/oracleIrTriggerLegacyRouting.js';
import { inferTriggeredAbilityTargetMetadata } from './server/src/state/modules/inferTriggeredAbilityTargetMetadata.js';

const cards = [
  { name: 'Dash Hopes', clause: 'any player may pay 5 life. If a player does, counter Dash Hopes' },
  { name: 'Temporal Extortion', clause: 'any player may pay half their life, rounded up. If a player does, counter Temporal Extortion' },
  { name: 'Phantasmagorian', clause: 'any player may discard three cards. If a player does, counter Phantasmagorian' },
  { name: 'Eldrazi Obligator', clause: 'you may pay {1}{C}. If you do, gain control of target creature until end of turn, untap that creature, and it gains haste until end of turn' },
  { name: 'Flayer of Loyalties', clause: 'gain control of target creature until end of turn. Untap that creature. Until end of turn, it has base power and toughness 10/10 and gains trample, annihilator 2, and haste' },
  { name: 'The Beast, Deathless Prince', clause: 'gain control of target creature until end of turn. Untap it. It gains menace and haste until end of turn' },
  { name: 'Hideous Taskmaster', clause: 'for each opponent, gain control of up to one target creature that player controls until end of turn. Untap those creatures. They gain trample, haste, and annihilator 1 until end of turn' },
  { name: 'Mutated Cultist', clause: 'remove all counters from up to one target permanent or opponent. The next spell you cast this turn costs {1} less to cast for each counter removed this way' },
];

for (const c of cards) {
  const full = `When you cast this spell, ${c.clause}.`;
  const ir = parseOracleTextToIR(full, c.name);
  const steps = ir.abilities.flatMap((a: any) => a.steps || []);
  console.log('\n====', c.name, '====');
  console.log('steps:', JSON.stringify(steps, null, 2).slice(0, 3000));
  console.log('meta:', JSON.stringify(inferTriggeredAbilityTargetMetadata(c.clause), null, 2));
  console.log('irWired:', isTriggerEffectFullyIrWired(c.clause, c.name));
}
