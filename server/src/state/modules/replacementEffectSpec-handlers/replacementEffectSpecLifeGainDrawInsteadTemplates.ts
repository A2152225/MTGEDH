// Origin parent: replacementEffectSpec.ts (collectReplacementEffectSpecsFromState)
// "If you would gain life, draw that many cards instead" (Lich / Nefarious Lich family, CR 614.1a).
// Public entry symbols: collectLifeGainDrawInsteadSpecsFromState.
// Leaf must not import replacementEffectSpec.ts or replacementEffectSpec-handlers/index.ts.

import type { ReplacementEffectSpec } from './replacementEffectSpecTypes.js';
import { readCardOracleText } from './replacementEffectSpecOracleTextUtils.js';
import { selfReferenceSentences } from './replacementEffectSpecDamagePreventionOracleTemplates.js';

export function collectLifeGainDrawInsteadSpecsFromState(state: unknown): ReplacementEffectSpec[] {
  const specs: ReplacementEffectSpec[] = [];
  const battlefield = Array.isArray((state as { battlefield?: unknown })?.battlefield)
    ? (state as { battlefield: unknown[] }).battlefield
    : [];
  for (const perm of battlefield as any[]) {
    if (!perm || typeof perm !== 'object' || !perm.card || perm.phasedOut === true) continue;
    const sourcePermanentId = String(perm.id || '').trim();
    const oracle = readCardOracleText(perm.card);
    if (!sourcePermanentId || !oracle || !/would gain life/i.test(oracle)) continue;
    const sourceName = String(perm.card?.name || 'Unknown').trim();
    if (!selfReferenceSentences(oracle, sourceName).some((s) => /^if you would gain life, draw that many cards instead$/.test(s))) continue;
    specs.push({
      id: `${sourcePermanentId}:life-gain-draw-instead`, event: 'life-gain-draw', instead: {},
      effectId: 'life-gain-draw-instead', reason: 'life_gain_draw_instead',
      sourcePermanentId, sourceController: String(perm.controller || '').trim(), sourceName,
    });
  }
  return specs;
}
