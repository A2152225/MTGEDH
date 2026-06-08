import { readFileSync } from 'fs';
import { detectAttackTriggers, detectCombatDamageTriggers, detectDeathTriggers, detectLTBTriggers, detectTargetedTriggers, detectETBTriggers, detectSpellCastTriggers, detectAbilityActivatedTriggers, detectBlockTriggers, detectDealtDamageTriggers, detectTapTriggers, detectDiscardTriggers, detectTransformTriggers, detectMonstrousTriggers, detectSpellCounteredTriggers, detectMutateTriggers, detectBeginningOfCombatTriggers, detectEndOfCombatTriggers, detectUntapTriggers } from '../src/state/modules/triggered-abilities.js';
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
import { detectCounterPlacedTriggers } from '../src/state/modules/triggers/counters.js';
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
  [/whenever you become the monarch/i, 'become_monarch'],
  [/whenever you have no cards in hand/i, 'empty_hand'],
  [/whenever a permanent leaves the battlefield/i, 'permanent_ltb'],
  [/whenever a creature leaves the battlefield/i, 'creature_ltb'],
  [/whenever a land enters the battlefield under an opponent/i, 'opp_land_etb'],
  [/whenever a creature enters the battlefield under an opponent/i, 'opp_creature_etb'],
  [/whenever an opponent creates a token/i, 'opp_create_token'],
  [/whenever you pay \{/i, 'you_pay_mana'],
  [/whenever a spell or ability an opponent controls causes you to discard/i, 'forced_discard'],
  [/whenever day becomes night or night becomes day/i, 'day_night'],
  [/whenever chaos ensues/i, 'chaos'],
  [/whenever you vote/i, 'you_vote'],
  [/whenever a player votes/i, 'player_vote'],
  [/whenever you set a scheme in motion/i, 'scheme'],
  [/whenever a creature you don't control attacks/i, 'uncontrolled_attacks'],
  [/whenever a creature without flying attacks/i, 'no_flying_attacks'],
  [/whenever you attack with two or more/i, 'attack_with_two'],
  [/whenever you gain control of/i, 'gain_control'],
  [/whenever you lose control of/i, 'lose_control'],
  [/whenever an opponent loses control of/i, 'opp_lose_control'],
  [/whenever a creature you control with flying attacks/i, 'flying_attacks'],
  [/whenever a creature attacks a battle/i, 'attacks_battle'],
  [/whenever a creature attacks a planeswalker/i, 'attacks_pw'],
  [/whenever a creature deals combat damage to a battle/i, 'combat_damage_battle'],
  [/whenever one or more dragons you control deal combat damage/i, 'dragons_combat'],
  [/whenever this creature or another creature you control with flying enters/i, 'flying_enters'],
  [/whenever a player attacks enchanted player/i, 'curse_attack'],
  [/whenever you or a permanent you control becomes the target/i, 'you_or_perm_targeted'],
  [/whenever a creature card is put into an opponent's graveyard/i, 'opp_gy_creature_card'],
  [/whenever a source deals damage to this creature/i, 'source_damage_self'],
  [/whenever this creature or equipped creature deals combat damage/i, 'self_or_equipped_cd'],
  [/whenever a creature you control deals combat damage to a creature/i, 'cd_to_creature'],
  [/whenever a samurai or warrior you control attacks alone/i, 'samurai_alone'],
  [/whenever a creature you control with power \d+ or less attacks/i, 'low_power_attacks'],
  [/whenever a creature you control with a \+1\/\+1 counter on it attacks/i, 'counter_attacks'],
  [/whenever a creature you control with a \+1\/\+1 counter on it becomes the target/i, 'counter_targeted'],
  [/whenever a creature you control with a \+1\/\+1 counter on it dies/i, 'counter_dies'],
  [/whenever a creature you control with a \+1\/\+1 counter on it leaves/i, 'counter_ltb'],
  [/whenever you create a token or put a counter/i, 'token_or_sticker'],
  [/whenever an opponent activates an ability of an artifact, creature, or land/i, 'opp_activate_acl'],
  [/at the beginning of your draw step, draw an additional card/i, 'draw_step_extra'],
  [/whenever one or more ninja or rogue creatures you control deal combat damage/i, 'ninja_rogue_cd'],
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
