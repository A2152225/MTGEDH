import fs from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import {
  detectETBTriggers, detectDeathTriggers, detectAttackTriggers, detectBlockTriggers,
  detectCombatDamageTriggers, detectTapTriggers, detectLTBTriggers, detectSpellCastTriggers,
  detectAbilityActivatedTriggers, detectDiscardTriggers, detectTargetedTriggers,
  detectEndStepTriggers,
} from '../src/state/modules/triggered-abilities.js';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { detectCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
import { detectLeftGraveyardTriggers, detectPutIntoGraveyardTriggers } from '../src/state/modules/triggers/zone-change.js';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { detectGainedLifeTriggersFromOracle } from '../src/state/modules/triggers/lifegain.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';

const byEvent = {
  enters_battlefield: [detectETBTriggers],
  dies: [detectDeathTriggers, detectPutIntoGraveyardTriggers, detectLeftGraveyardTriggers],
  attacks: [detectAttackTriggers],
  blocks: [detectBlockTriggers],
  deals_combat_damage_to_player: [detectCombatDamageTriggers],
  becomes_tapped: [detectTapTriggers],
  discarded: [detectDiscardTriggers],
  targeted: [detectTargetedTriggers],
  beginning_of_upkeep: [detectUpkeepTriggers],
  beginning_of_end_step: [detectEndStepTriggers],
  sacrificed: [detectSacrificeTriggers],
  counter_placed: [detectCounterPlacedTriggers],
  ability_activated: [detectAbilityActivatedTriggers],
  spell_cast: [detectSpellCastTriggers],
  gained_life: [detectGainedLifeTriggersFromOracle],
  lost_life: [detectLifeLossTriggers],
};

const cards = JSON.parse(fs.readFileSync('../oracle-cards.json', 'utf8'));
const permanent = { id: 'P1', controller: 'P1' };
const counts = new Map();
let shown = 0;

for (const card of cards) {
  const text = [card.oracle_text, ...(card.card_faces || []).map((f) => f.oracle_text)].filter(Boolean).join('\n');
  if (!text) continue;
  for (const t of parseTriggeredAbilitiesFromText(text, 'S', 'P1', card.name)) {
    if (t.triggerFilter === 'unknown_trigger_pattern') continue;
    const fns = byEvent[t.event];
    if (!fns) continue;
    const cardObj = { name: card.name, oracle_text: text, type_line: card.type_line };
    if (fns.some((fn) => fn(cardObj, permanent).length > 0)) continue;
    const key = `${t.event}|${String(t.condition || t.triggerFilter || '').slice(0, 55)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (shown < 20) {
      console.log(card.name, '|', t.event, '|', t.condition || t.triggerFilter);
      console.log(' ', String(t.effect || '').slice(0, 80));
      shown++;
    }
  }
}
console.log('\nTop known-event not detected:');
[...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).forEach(([k, n]) => console.log(n, k));
