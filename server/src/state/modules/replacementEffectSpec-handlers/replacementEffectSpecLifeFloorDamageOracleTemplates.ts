// Origin parent: server/src/state/modules/replacementEffectSpec.ts
// Cluster moved: Worship / Fortune Thief / Angel's Grace "damage that would
//   reduce your life total to less than 1 reduces it to 1 instead" family.
// Public entry symbols: collectOraclePatternLifeFloorDamageReplacementSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { normalizeOraclePatternText, readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';

const LIFE_FLOOR_DAMAGE_RE =
  /damage that would reduce your life total to less than (\d+) reduces it to \1 instead/;

export function collectOraclePatternLifeFloorDamageReplacementSpecsFromState(
  state: unknown,
): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object' || !(perm as { card?: unknown }).card) continue;
    const permRecord = perm as {
      id?: string;
      controller?: string;
      phasedOut?: boolean;
      card?: { name?: string; oracle_text?: string; oracleText?: string };
    };
    if (permRecord.phasedOut === true) continue;
    const oracle = normalizeOraclePatternText(readCardOracleText(permRecord.card));
    if (!oracle) continue;
    const match = oracle.match(LIFE_FLOOR_DAMAGE_RE);
    if (!match) continue;

    const sourcePermanentId = String(permRecord.id || '').trim();
    const sourceController = String(permRecord.controller || '').trim();
    const sourceName = String(permRecord.card?.name || 'Unknown').trim();
    if (!sourcePermanentId) continue;

    const floorLifeAt = Math.max(1, Math.floor(Number(match[1]) || 1));
    const requiresCreature = oracle.includes('if you control a creature');

    specs.push({
      id: `${sourcePermanentId}:life-floor-damage`,
      event: 'damage',
      match: {
        receivingPlayerIsSourceController: true,
        ...(requiresCreature ? { requiresSourceControllerControlsCreature: true } : {}),
      },
      instead: { floorLifeAt },
      effectId: requiresCreature
        ? 'life-floor-damage-if-you-control-a-creature'
        : 'life-floor-damage',
      reason: requiresCreature
        ? 'worship_style_life_floor_if_creature'
        : 'life_floor_damage_replacement',
      sourcePermanentId,
      sourceController,
      sourceName,
    });
  }

  return specs;
}
