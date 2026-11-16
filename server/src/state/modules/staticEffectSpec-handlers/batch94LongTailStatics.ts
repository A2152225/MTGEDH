// server/src/state/modules/staticEffectSpec-handlers/batch94LongTailStatics.ts
// B94 long-tail statics: Trinisphere cost floor, Cunning Giant / Butcher Orgg
// damage assignment, Quark can't-sacrifice-Treasures, Curse of Leeches
// transform-attach, Archon of Coronation monarch damage-to-life, Species 8472
// artifact-ability targeting restriction (grant only).
// Public: pushBatch94LongTailStaticSpecs.

import type { StaticEffectSpec } from '../staticEffectSpecTypes.js';
import { buildSpec, type StaticEffectSpecSource } from './staticEffectSpecOracleParseHelpers.js';
import { normalizeOraclePatternText } from '../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js';
import { parseBatch94MinManaCostSentence } from '../batch94CastCost.js';
import { parseTransformsAttachToPlayer } from '../batch94TransformAttach.js';

export function pushBatch94LongTailStaticSpecs(
  specs: StaticEffectSpec[],
  source: StaticEffectSpecSource,
  _perm: unknown,
  oracle: string,
): void {
  const text = normalizeOraclePatternText(String(oracle || '')).replace(/\u2019/g, "'");
  if (parseBatch94MinManaCostSentence(oracle)) {
    specs.push(buildSpec(source, 'min-mana-cost-floor-while-untapped', { kind: 'self' }, { abilities: ['min_mana_cost_floor_while_untapped'] }));
  }
  if (/if this creature is unblocked, you may have it assign its combat damage to a creature defending player controls/i.test(text)) {
    specs.push(buildSpec(source, 'optional-assign-combat-damage-to-defender-creature', { kind: 'self' }, { abilities: ['may_assign_unblocked_combat_damage_to_defender_creature'] }));
  }
  if (/you may assign this creature's combat damage divided as you choose among defending player and\/or any number of creatures they control/i.test(text)) {
    specs.push(buildSpec(source, 'divide-combat-damage-among-defender-and-creatures', { kind: 'self' }, { abilities: ['may_divide_combat_damage_among_defender_and_creatures'] }));
  }
  if (/you can't sacrifice treasure tokens/i.test(text)) {
    specs.push(buildSpec(source, 'cant-sacrifice-treasure-tokens', { kind: 'player_you' }, { abilities: ['cant_sacrifice_treasure_tokens'] }));
  }
  if (parseTransformsAttachToPlayer(oracle)) {
    specs.push(buildSpec(source, 'on-transform-attach-to-a-player', { kind: 'self' }, { abilities: ['on_transform_attach_to_a_player'] }));
  }
  if (/as long as you're the monarch, damage doesn't cause you to lose life/i.test(text)) {
    specs.push(buildSpec(source, 'monarch-damage-does-not-cause-life-loss', { kind: 'player_you' }, { abilities: ['damage_does_not_cause_life_loss'] }));
  }
  if (/can't be the target of abilities from artifact sources your opponents control/i.test(text)) {
    specs.push(buildSpec(source, 'cant-be-targeted-by-opponent-artifact-abilities', { kind: 'self' }, { abilities: ['cant_be_targeted_by_opponent_artifact_abilities'] }));
  }
  void specs;
}
