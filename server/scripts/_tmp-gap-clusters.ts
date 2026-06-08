import { readFileSync } from 'fs';
import { parseTriggeredAbilitiesFromText } from '../../rules-engine/src/triggeredAbilitiesParsing.js';
import { detectAttackTriggers, detectCombatDamageTriggers, detectDeathTriggers, detectLTBTriggers, detectTargetedTriggers, detectETBTriggers, detectSpellCastTriggers, detectAbilityActivatedTriggers, detectBlockTriggers, detectDealtDamageTriggers, detectTapTriggers, detectDiscardTriggers, detectTransformTriggers, detectMonstrousTriggers, detectSpellCounteredTriggers, detectMutateTriggers, detectBeginningOfCombatTriggers, detectEndOfCombatTriggers, detectUntapTriggers, detectAttachmentAttackTriggers } from '../src/state/modules/triggered-abilities.js';
import { detectSacrificeTriggers } from '../src/state/modules/triggers/sacrifice.js';
import { detectOpponentSpellCastTriggers } from '../src/state/modules/triggers/spell-cast.js';
import { detectLandfallTriggers } from '../src/state/modules/triggers/landfall.js';
import { detectCardDrawTriggers } from '../src/state/modules/triggers/card-draw.js';
import { detectUpkeepTriggers } from '../src/state/modules/upkeep-triggers.js';
import { detectEndStepTriggers, detectDrawStepTriggers, detectPostcombatMainTriggers, detectPrecombatMainTriggers } from '../src/state/modules/triggers/turn-phases.js';
import { detectLifeLossTriggers } from '../src/state/modules/triggers/life-loss.js';
import { detectGainedLifeTriggersFromOracle } from '../src/state/modules/triggers/lifegain.js';
import { detectPutIntoGraveyardTriggers, detectExiledFromBattlefieldTriggers, detectLeftGraveyardTriggers } from '../src/state/modules/triggers/zone-change.js';
import { detectMillTriggers } from '../src/state/modules/triggers/mill.js';
import { detectCounterPlacedTriggers, detectCounterRemovedTriggers } from '../src/state/modules/triggers/counters.js';
import { detectTokenCreatedTriggers } from '../src/state/modules/triggers/tokens.js';
import { detectPayLifeTriggers } from '../src/state/modules/triggers/pay-life.js';

const P = { id: 'P1', controller: 'P1' };
const cards = JSON.parse(readFileSync(JSON.parse(readFileSync('scripts/out/trigger-coverage-audit.json', 'utf8')).meta.oraclePath, 'utf8'));

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
  detectAttachmentAttackTriggers(c, P).length +
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
  detectCounterRemovedTriggers(c, P).length +
  detectMonstrousTriggers(c, P).length +
  detectTokenCreatedTriggers(c, P).length +
  detectPayLifeTriggers(c, P).length +
  detectBeginningOfCombatTriggers(c, P).length +
  detectEndOfCombatTriggers(c, P).length +
  detectUntapTriggers(c, P).length +
  detectDiscardTriggers(c, P).length +
  detectSpellCounteredTriggers(c, P).length +
  detectMutateTriggers(c, P).length +
  detectEndStepTriggers(c, P).length +
  detectDrawStepTriggers(c, P).length +
  detectPostcombatMainTriggers(c, P).length +
  detectPrecombatMainTriggers(c, P).length +
  detectLeftGraveyardTriggers(c, P).length
);

const patterns: Array<[RegExp, string]> = [
  [/whenever an opponent sacrifices/i, 'opp_sacrifice'],
  [/whenever a player sacrifices/i, 'player_sacrifice'],
  [/whenever you vote/i, 'you_vote'],
  [/whenever a player votes/i, 'player_vote'],
  [/whenever you specialize/i, 'specialize'],
  [/when this creature specializes/i, 'specialize_creature'],
  [/whenever a creature deals combat damage to a battle/i, 'cd_battle'],
  [/whenever a creature deals combat damage to a planeswalker/i, 'cd_pw'],
  [/whenever equipped creature deals combat damage/i, 'equipped_cd'],
  [/whenever enchanted creature deals combat damage/i, 'enchanted_cd'],
  [/whenever a creature deals damage to a player/i, 'damage_player'],
  [/whenever a creature deals damage to an opponent/i, 'damage_opp'],
  [/whenever you cast a spell,?\s*copy it/i, 'copy_on_cast'],
  [/whenever you cast a spell from anywhere other than your hand/i, 'cast_not_hand'],
  [/whenever you cast a spell from exile/i, 'cast_exile'],
  [/whenever you cast a spell from a graveyard/i, 'cast_gy'],
  [/whenever an opponent casts an instant or sorcery spell/i, 'opp_cast_is'],
  [/whenever you cast an instant or sorcery spell/i, 'cast_is'],
  [/whenever a permanent becomes tapped/i, 'perm_tapped'],
  [/whenever a creature becomes tapped/i, 'creature_tapped'],
  [/whenever you become encumbered/i, 'encumbered'],
  [/whenever you become the monarch/i, 'monarch'],
  [/whenever you draw your second card/i, 'second_draw'],
  [/whenever an opponent draws their second card/i, 'opp_second_draw'],
  [/whenever a creature is regenerated/i, 'regenerated'],
  [/whenever a creature regenerates/i, 'regenerates'],
  [/whenever you regenerate a creature/i, 'you_regenerate'],
  [/whenever a creature mutates/i, 'mutates'],
  [/whenever a creature you control mutates/i, 'controlled_mutates'],
  [/whenever you mutate/i, 'you_mutate'],
  [/whenever a creature is equipped/i, 'equipped'],
  [/whenever an equipment enters/i, 'equipment_etb'],
  [/whenever an aura enters/i, 'aura_etb'],
  [/whenever an artifact enters/i, 'artifact_etb'],
  [/whenever a planeswalker enters/i, 'pw_etb'],
  [/whenever a battle enters/i, 'battle_etb'],
  [/whenever a vehicle enters/i, 'vehicle_etb'],
  [/whenever a creature with defender attacks/i, 'defender_attacks'],
  [/whenever a creature with menace attacks/i, 'menace_attacks'],
  [/whenever a creature with trample attacks/i, 'trample_attacks'],
  [/whenever a legendary creature attacks/i, 'legendary_attacks'],
  [/whenever a legendary creature you control attacks/i, 'legendary_controlled_attacks'],
  [/whenever an artifact creature attacks/i, 'artifact_creature_attacks'],
  [/whenever an artifact you control attacks/i, 'artifact_attacks'],
  [/whenever a token attacks/i, 'token_attacks'],
  [/whenever a token you control attacks/i, 'token_controlled_attacks'],
  [/whenever a nontoken creature attacks/i, 'nontoken_attacks'],
  [/whenever a nontoken creature you control attacks/i, 'nontoken_controlled_attacks'],
  [/whenever a modified creature attacks/i, 'modified_attacks'],
  [/whenever a modified creature you control attacks/i, 'modified_controlled_attacks'],
  [/whenever a creature with a \+1\/\+1 counter on it attacks/i, 'counter_attacks'],
  [/whenever a creature with a \-1\/\-1 counter on it attacks/i, 'minus_counter_attacks'],
  [/whenever a creature with a counter on it attacks/i, 'any_counter_attacks'],
  [/whenever a creature with a counter on it dies/i, 'counter_dies'],
  [/whenever a creature with a counter on it leaves/i, 'counter_ltb'],
  [/whenever a creature with a counter on it deals combat damage/i, 'counter_cd'],
  [/whenever a creature with a counter on it becomes the target/i, 'counter_targeted'],
  [/whenever a creature with a counter on it enters/i, 'counter_etb'],
  [/whenever a creature with a counter on it is dealt damage/i, 'counter_dealt_damage'],
  [/whenever a creature with a counter on it is destroyed/i, 'counter_destroyed'],
  [/whenever a creature with a counter on it is exiled/i, 'counter_exiled'],
  [/whenever a creature with a counter on it is put into a graveyard/i, 'counter_gy'],
  [/whenever a creature with a counter on it is put onto the battlefield/i, 'counter_etb2'],
  [/whenever a creature with a counter on it is returned to/i, 'counter_return'],
  [/whenever a creature with a counter on it is sacrificed/i, 'counter_sac'],
  [/whenever a creature with a counter on it is tapped/i, 'counter_tap'],
  [/whenever a creature with a counter on it is untapped/i, 'counter_untap'],
  [/whenever a creature with a counter on it blocks/i, 'counter_blocks'],
  [/whenever a creature with a counter on it becomes blocked/i, 'counter_blocked'],
  [/whenever a creature with a counter on it becomes the target of a spell or ability/i, 'counter_targeted2'],
  [/whenever a creature with a counter on it becomes the target of a spell an opponent controls/i, 'counter_targeted_opp'],
  [/whenever a creature with a counter on it becomes the target of an opponent/i, 'counter_targeted_opp2'],
  [/whenever a creature with a counter on it becomes the target of your/i, 'counter_targeted_you'],
  [/whenever a creature with a counter on it becomes the target of a spell you control/i, 'counter_targeted_you_spell'],
  [/whenever a creature with a counter on it becomes the target of an ability you control/i, 'counter_targeted_you_ability'],
  [/whenever a creature with a counter on it becomes the target of a spell or ability you control/i, 'counter_targeted_you_both'],
  [/whenever a creature with a counter on it becomes the target of a spell or ability an opponent controls/i, 'counter_targeted_opp_both'],
  [/whenever a creature with a counter on it becomes the target of a spell or ability an opponent controls,?\s*put/i, 'counter_targeted_opp_put'],
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
