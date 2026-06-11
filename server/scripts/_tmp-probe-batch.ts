import { readFileSync } from 'fs';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import {
  detectTargetedTriggers,
  detectTapTriggers,
  detectDeathTriggers,
  detectETBTriggers,
  detectDealtDamageTriggers,
  detectBlockTriggers,
  detectCombatDamageTriggers,
  detectAttackTriggers,
  detectLTBTriggers,
  detectTransformTriggers,
  detectSpellCastTriggers,
  detectAbilityActivatedTriggers,
  detectMonstrousTriggers,
} from '../src/state/modules/triggered-abilities.js';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { detectGainedLifeTriggersFromOracle } from '../src/state/modules/triggers/lifegain.js';
import { detectCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectPutIntoGraveyardTriggers, detectExiledFromBattlefieldTriggers } from '../src/state/modules/triggers/zone-change.js';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { detectMillTriggers } from '../src/state/modules/triggers/mill.js';
import { detectCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';

const P = { id: 'P1', controller: 'P1' };
const oraclePath = JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8')).meta.oraclePath;
const cards = JSON.parse(readFileSync(oraclePath, 'utf8'));

const allDetectors = (c: any) => (
  detectOpponentSpellCastTriggers(c, P).length +
  detectSpellCastTriggers(c, P).length +
  detectTargetedTriggers(c, P).length +
  detectTapTriggers(c, P).length +
  detectDeathTriggers(c, P).length +
  detectETBTriggers(c, P).length +
  detectSacrificeTriggers(c, P).length +
  detectDealtDamageTriggers(c, P).length +
  detectBlockTriggers(c, P).length +
  detectCombatDamageTriggers(c, P).length +
  detectAttackTriggers(c, P).length +
  detectLTBTriggers(c, P).length +
  detectTransformTriggers(c, P).length +
  detectLifeLossTriggers(c, P).length +
  detectGainedLifeTriggersFromOracle(c, P).length +
  detectCardDrawTriggers(c, P).length +
  detectPutIntoGraveyardTriggers(c, P).length +
  detectUpkeepTriggers(c, P).length +
  detectMillTriggers(c, P).length +
  detectExiledFromBattlefieldTriggers(c, P).length +
  detectAbilityActivatedTriggers(c, P).length +
  detectCounterPlacedTriggers(c, P).length +
  detectMonstrousTriggers(c, P).length
);

const patterns: Array<[RegExp, string]> = [
  [/whenever an opponent sacrifices/i, 'opp_sacrifice'],
  [/whenever a player sacrifices/i, 'player_sacrifice'],
  [/whenever you pay \{/i, 'you_pay'],
  [/whenever you have no cards in hand/i, 'empty_hand'],
  [/whenever a permanent leaves the battlefield/i, 'permanent_ltb'],
  [/whenever a creature leaves the battlefield/i, 'creature_ltb'],
  [/whenever a land enters the battlefield under an opponent/i, 'opp_land_etb'],
  [/whenever a creature enters the battlefield under an opponent/i, 'opp_creature_etb'],
  [/whenever you become the monarch/i, 'become_monarch'],
  [/whenever you create a token/i, 'you_create_token'],
  [/whenever an opponent creates a token/i, 'opp_create_token'],
  [/whenever you put a counter on/i, 'you_put_counter'],
  [/whenever a creature you control becomes blocked/i, 'controlled_blocked'],
  [/whenever a creature without flying attacks/i, 'no_flying_attacks'],
  [/whenever a creature you don't control attacks/i, 'uncontrolled_attacks'],
  [/whenever you cast a spell,?\s*copy it/i, 'copy_spell'],
  [/whenever you copy a spell/i, 'you_copy_spell'],
  [/whenever a creature you control deals combat damage/i, 'controlled_combat_damage'],
  [/whenever a battle enters/i, 'battle_etb'],
  [/whenever you vote/i, 'you_vote'],
  [/whenever a player votes/i, 'player_vote'],
  [/whenever you set a scheme in motion/i, 'scheme'],
  [/whenever you crank/i, 'crank'],
  [/whenever you draw your second card/i, 'second_draw'],
  [/whenever an opponent draws their second card/i, 'opp_second_draw'],
  [/whenever you cast a spell from anywhere other than your hand/i, 'cast_not_hand'],
  [/whenever you cast a spell from exile/i, 'cast_exile'],
  [/whenever you cast a spell from a graveyard/i, 'cast_gy'],
  [/whenever you cast an instant or sorcery spell/i, 'cast_instant_sorcery'],
  [/whenever an opponent casts an instant or sorcery spell/i, 'opp_cast_is'],
  [/whenever a creature you control with a \+1\/\+1 counter/i, 'counter_creature'],
  [/whenever you gain control of/i, 'gain_control'],
  [/whenever you lose control of/i, 'lose_control'],
  [/whenever an opponent loses control of/i, 'opp_lose_control'],
  [/whenever a creature you control with flying attacks/i, 'flying_attacks'],
  [/whenever you attack with two or more/i, 'attack_with_two'],
  [/whenever you attack with a creature with power/i, 'attack_with_power'],
  [/whenever an opponent attacks with a creature with power/i, 'opp_attack_power'],
  [/whenever a creature attacks a battle/i, 'attacks_battle'],
  [/whenever a creature attacks a planeswalker/i, 'attacks_pw'],
  [/whenever a creature attacks a player/i, 'attacks_player'],
  [/whenever a creature deals combat damage to a battle/i, 'combat_damage_battle'],
  [/whenever a creature deals combat damage to a planeswalker/i, 'combat_damage_pw'],
  [/whenever a creature deals combat damage to an opponent/i, 'combat_damage_opp'],
  [/whenever a creature deals damage to an opponent/i, 'damage_opp'],
  [/whenever a creature deals damage to a player/i, 'damage_player'],
  [/whenever a creature deals damage to a planeswalker/i, 'damage_pw'],
  [/whenever a creature deals damage to a battle/i, 'damage_battle'],
  [/whenever a creature deals damage to you/i, 'damage_you'],
  [/whenever a creature deals damage to your commander/i, 'damage_commander'],
  [/whenever a creature deals damage to a source/i, 'damage_source'],
  [/whenever a creature deals damage to a permanent/i, 'damage_permanent'],
  [/whenever a creature deals damage to a creature/i, 'damage_creature'],
  [/whenever a creature deals damage to an artifact/i, 'damage_artifact'],
  [/whenever a creature deals damage to an enchantment/i, 'damage_enchantment'],
  [/whenever a creature deals damage to a land/i, 'damage_land'],
  [/whenever a creature deals damage to a token/i, 'damage_token'],
  [/whenever a creature deals damage to a spell/i, 'damage_spell'],
  [/whenever a creature deals damage to a triggered ability/i, 'damage_triggered'],
  [/whenever a creature deals damage to a static ability/i, 'damage_static'],
  [/whenever a creature deals damage to a loyalty ability/i, 'damage_loyalty'],
  [/whenever a creature deals damage to a mana ability/i, 'damage_mana'],
  [/whenever a creature deals damage to a activated ability/i, 'damage_activated'],
  [/whenever a creature deals damage to a triggered ability/i, 'damage_triggered2'],
];

for (const [re, label] of patterns) {
  const misses: Array<{ name: string; clause: string }> = [];
  let total = 0;
  for (const card of cards) {
    const oracle = String(card.oracle_text || '');
    if (!re.test(oracle)) continue;
    total++;
    const clause = oracle.split(/\n/).find((l: string) => re.test(l)) || oracle.slice(0, 120);
    const c = { name: card.name, oracle_text: oracle, type_line: card.type_line };
    if (allDetectors(c) === 0 && misses.length < 2) {
      misses.push({ name: String(card.name), clause: clause.trim().slice(0, 110) });
    }
  }
  if (misses.length > 0 && total >= 2) {
    console.log(`\n${label} (${total} cards)`);
    for (const m of misses) console.log(`  ${m.name}: ${m.clause}`);
  }
}
