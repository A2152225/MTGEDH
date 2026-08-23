import { parseOracleTextToIR } from './rules-engine/src/oracleIRParser.js';
import { isTriggerEffectFullyIrWired } from './server/src/state/modules/oracleIrTriggerLegacyRouting.js';
import { inferTriggeredAbilityTargetMetadata } from './server/src/state/modules/inferTriggeredAbilityTargetMetadata.js';

const cards = [
  {
    name: 'Emrakul, the Promised End',
    clause: "you gain control of target opponent during that player's next turn. After that turn, that player takes an extra turn",
  },
  {
    name: 'Emrakul, the World Anew',
    clause: 'gain control of all creatures target player controls',
  },
  {
    name: 'Lashweed Lurker',
    clause: "you may put target nonland permanent on top of its owner's library",
  },
  {
    name: 'Brain Gorgers',
    clause: 'any player may sacrifice a creature of their choice. If a player does, counter Brain Gorgers',
  },
];

for (const c of cards) {
  const full = `When you cast this spell, ${c.clause}.`;
  const ir = parseOracleTextToIR(full, c.name);
  const steps = ir.abilities.flatMap((a: any) => a.steps || []);
  console.log('\n====', c.name, '====');
  console.log('steps:', JSON.stringify(steps, null, 2).slice(0, 2000));
  console.log('meta:', inferTriggeredAbilityTargetMetadata(c.clause));
  console.log('irWired:', isTriggerEffectFullyIrWired(c.clause, c.name));
}
