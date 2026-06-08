import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { detectTriggeredAbilityEvent } from '../../rules-engine/src/triggeredAbilitiesEventDetection.js';
import { TriggerEvent } from '../../rules-engine/src/triggeredAbilitiesTypes.js';

const samples: [string, string][] = [
  ['Utopia Sprawl', 'Enchant Forest\nAs this Aura enters, choose a color.\nWhenever enchanted Forest is tapped for mana, its controller adds an additional one mana of the chosen color.'],
  ['Divine Intervention', 'This enchantment enters with two intervention counters on it.\nAt the beginning of your upkeep, remove an intervention counter from this enchantment.'],
  ['Tarnation', 'Whenever chaos ensues, Tarnation deals 1 damage to each opponent.'],
  ['Mindlink Mech', 'Whenever this Vehicle becomes crewed for the first time each turn, until end of turn, this Vehicle becomes a copy of target nonlegendary creature that crewed it this turn.'],
];

for (const [name, o] of samples) {
  const parsed = parseTriggeredAbilitiesFromText(o, 'SRC', 'P1', name);
  console.log(`\n${name}:`);
  for (const t of parsed) {
    console.log(' ', { event: t.event, filter: t.triggerFilter, cond: t.condition, effect: t.effect?.slice(0, 60) });
  }
}

console.log('\ndirect tests:');
for (const cond of [
  'the beginning of your upkeep',
  'enchanted forest is tapped for mana',
  'chaos ensues',
  'this vehicle becomes crewed for the first time each turn',
  'this enchantment enters',
  'this creature enters',
  'as this aura enters, choose a color',
]) {
  console.log(cond, '->', detectTriggeredAbilityEvent(cond, TriggerEvent));
}
