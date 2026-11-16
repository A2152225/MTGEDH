// server/src/state/modules/staticEffectSpec-handlers/batch93LongTailStatics.ts
// B93 long-tail statics: Elesh Norn ETB suppression / additional time,
// Phyrexian Unlife infect-as, Mana Maze, Halls of Mist, Infinite Reflection
// etb-as-copy, Dr. Beverly Crusher life-gain additional time, Myr Superion
// creature-mana restriction (already parsed in B92; re-asserted), Aetherspark
// can't-be-attacked (already parsed in B92).
// Public: pushBatch93LongTailStaticSpecs.

import type { StaticEffectSpec, StaticEffectCondition } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { normalizeOraclePatternText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { parseEleshNornOpponentEtbSuppression, parseEnteringCausesAdditionalTrigger, parseLifeGainCausesAdditionalTrigger } from '../batch93TriggerSuppression.js';
import { parseBatch93EtbCopySentence } from '../batch93EtbCopy.js';
import { parseBatch93HallsOfMistSentence } from '../batch93AttackRestrictions.js';
import { parseManaMazeSentence } from '../batch93CastRestrictions.js';

export function pushBatch93LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  if (parseEleshNornOpponentEtbSuppression(oracle)) {
    specs.push(buildSpec(source, 'etb-suppress-opponent-triggers', { kind: 'player_opponents' }, { abilities: ['etb_does_not_cause_triggers'] }));
  }
  if (parseEnteringCausesAdditionalTrigger(oracle)) {
    specs.push(buildSpec(source, 'etb-causes-additional-trigger', { kind: 'player_you' }, { abilities: ['etb_triggers_additional_time'] }));
  }
  if (parseLifeGainCausesAdditionalTrigger(oracle)) {
    specs.push(buildSpec(source, 'life-gain-causes-additional-trigger', { kind: 'player_you' }, { abilities: ['life_gain_triggers_additional_time'] }));
  }
  if (/as long as you have 0 or less life, all damage is dealt to you as though its source had infect/i.test(text)) {
    specs.push(buildSpec(source, 'damage-as-infect-at-zero-life', { kind: 'player_you' }, { abilities: ['damage_to_you_as_infect'] }, { kind: 'controller_life_zero_or_less' } as unknown as StaticEffectCondition));
  }
  if (parseManaMazeSentence(oracle)) {
    specs.push(buildSpec(source, 'cant-cast-sharing-color-with-last-spell:you', { kind: 'player_you' }, { abilities: ['cant_cast_sharing_color_with_last_spell_this_turn'] }));
    specs.push(buildSpec(source, 'cant-cast-sharing-color-with-last-spell:opponents', { kind: 'player_opponents' }, { abilities: ['cant_cast_sharing_color_with_last_spell_this_turn'] }));
  }
  if (parseBatch93HallsOfMistSentence(oracle)) {
    specs.push(buildSpec(source, 'attacked-last-turn-cant-attack', { kind: 'all_creatures' }, { abilities: ['cant_attack_if_attacked_last_turn'] }));
  }
  if (parseBatch93EtbCopySentence(oracle)) {
    specs.push(buildSpec(source, 'nontoken-creatures-enter-as-copy-of-enchanted', { kind: 'creatures_you_control' }, { abilities: ['enter_as_copy_of_enchanted_creature'] }));
  }
  void specs;
}
