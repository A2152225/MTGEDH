// server/src/state/modules/replacementBatch21DamageScaling.ts
// Batch 21: damage amount replacements whose value or match depends on the source permanent itself.
//  - Fated Firepower: "If a source you control would deal damage to an opponent or a permanent an opponent controls,
//    it deals that much damage plus an amount of damage equal to the number of fire counters on this enchantment
//    instead" -> add_flat = current fire counters (no spec at 0 counters).
//  - Far Fortune, End Boss: "Max speed - If a source you control would deal damage to an opponent or a permanent an
//    opponent controls, it deals that much damage plus 1 instead" -> add_flat N, only while the controller's speed is 4+
//    (ungated wording is always on).
//  - Charging Tuskodon: "If this creature would deal combat damage to a player, it deals double that damage to that
//    player instead" -> double, combat only, player receivers only, damage source must be this permanent.
// Called from collectOraclePatternDamageReplacementSpecsFromState for every battlefield permanent.
// Public entry symbols: collectBatch21DamageScalingSpecs.
// Leaf: must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpec-handlers/replacementEffectSpecTypes.js';

const FIRE_COUNTER_PLUS_RE =
  /if a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus an amount of damage equal to the number of fire counters on (?:this enchantment|this permanent|~) instead/;
const PLUS_N_RE =
  /(max speed\s*[\u2014-]\s*)?if a source you control would deal damage to an opponent or a permanent an opponent controls, it deals that much damage plus (\d+) instead/;
const SELF_COMBAT_DOUBLE_RE =
  /if (?:this creature|~) would deal combat damage to a player, it deals double that damage to that player instead/;

function counterCount(counters: unknown, kind: string): number {
  if (!counters || typeof counters !== 'object') return 0;
  const n = Number((counters as Record<string, unknown>)[kind]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function speedOf(state: unknown, playerId: string): number {
  if (!state || typeof state !== 'object' || !('speed' in state)) return 0;
  const speed = state.speed;
  if (!speed || typeof speed !== 'object') return 0;
  const n = Number((speed as Record<string, unknown>)[playerId]);
  return Number.isFinite(n) ? n : 0;
}

export function collectBatch21DamageScalingSpecs(
  oracle: string,
  source: { sourcePermanentId: string; sourceController: string; sourceName: string; counters?: unknown },
  state?: unknown,
): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const base = {
    sourcePermanentId: source.sourcePermanentId,
    sourceController: source.sourceController,
    sourceName: source.sourceName,
  };
  if (FIRE_COUNTER_PLUS_RE.test(oracle)) {
    const fire = counterCount(source.counters, 'fire');
    if (fire > 0) {
      specs.push({
        ...base,
        id: `${source.sourcePermanentId}:source-you-control-damage-plus-fire-counters`,
        event: 'damage',
        match: { dealingPlayerIsSourceController: true, receivingPlayerIsOpponentOfSource: true },
        instead: { modify: 'add_flat', value: fire },
        effectId: 'source-you-control-damage-plus-fire-counters',
        reason: 'source_you_control_damage_plus_fire_counters',
      });
    }
  }
  const plusN = oracle.match(PLUS_N_RE);
  if (plusN && (!plusN[1] || speedOf(state, source.sourceController) >= 4)) {
    const n = Number(plusN[2]);
    specs.push({
      ...base,
      id: `${source.sourcePermanentId}:source-you-control-damage-plus-${n}`,
      event: 'damage',
      match: { dealingPlayerIsSourceController: true, receivingPlayerIsOpponentOfSource: true },
      instead: { modify: 'add_flat', value: n },
      effectId: `source-you-control-damage-plus-${n}`,
      reason: `source_you_control_damage_plus_${n}`,
    });
  }
  if (SELF_COMBAT_DOUBLE_RE.test(oracle)) {
    specs.push({
      ...base,
      id: `${source.sourcePermanentId}:self-combat-damage-to-player-double`,
      event: 'damage',
      match: { combatDamageOnly: true, receivingIsPlayerOnly: true, damageSourceIsSource: true },
      instead: { modify: 'double' },
      effectId: 'self-combat-damage-to-player-double',
      reason: 'self_combat_damage_to_player_double',
    });
  }
  return specs;
}
