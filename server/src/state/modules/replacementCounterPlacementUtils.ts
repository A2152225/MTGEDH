import type { PlayerID } from '../../../../shared/src';
import {
  applyBeneficialReplacements,
  applyReplacementsCustomOrder,
  type ReplacementEffect,
} from './game-state-effects.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec.js';
import { overlayReplacementSpecToEffect, overlaySpecsMatchCounterPlacement } from './replacementEffectSpec.js';

function counterEffectsForType(
  counterType: string,
  overlaySpecs: readonly ReplacementEffectSpec[],
  targetController: PlayerID,
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];

  for (const spec of overlaySpecs) {
    if (spec.event !== 'counter-placement' || !spec.instead.modify) continue;
    if (!overlaySpecsMatchCounterPlacement(spec, { counterType, targetController })) continue;
    effects.push(overlayReplacementSpecToEffect(spec));
  }

  return effects;
}

function applyCounterPreferenceOrdering(
  gameState: any,
  targetController: PlayerID,
  amount: number,
  effects: ReplacementEffect[],
): number {
  const pref = (gameState as any)?.replacementEffectPreferences?.[targetController]?.counters;
  const mode: 'minimize' | 'maximize' | 'custom' | 'auto' = pref?.mode
    ? pref.mode
    : (pref?.useCustomOrder ? 'custom' : 'auto');

  if (mode === 'custom' && Array.isArray(pref?.customOrder) && pref.customOrder.length > 0) {
    const orderIndex = new Map<string, number>();
    for (let i = 0; i < pref.customOrder.length; i++) orderIndex.set(String(pref.customOrder[i]), i);
    const ordered = [...effects].sort((a, b) => {
      const ai = orderIndex.has(a.source) ? (orderIndex.get(a.source) as number) : Number.POSITIVE_INFINITY;
      const bi = orderIndex.has(b.source) ? (orderIndex.get(b.source) as number) : Number.POSITIVE_INFINITY;
      if (ai !== bi) return ai - bi;
      return String(a.source).localeCompare(String(b.source));
    });
    return applyReplacementsCustomOrder(amount, ordered).finalAmount;
  }

  return applyBeneficialReplacements(amount, effects).finalAmount;
}

export function computeCounterPlacementModifiedDeltas(
  gameState: any,
  targetPermanentId: string,
  deltas: Record<string, number>,
  overlaySpecs: readonly ReplacementEffectSpec[] = [],
): Record<string, number> {
  const targetPermanent = (gameState?.battlefield || []).find((p: any) => p.id === targetPermanentId);
  if (!targetPermanent) return deltas;

  const targetController = targetPermanent.controller as PlayerID;
  if (overlaySpecs.length === 0) return deltas;

  const modified: Record<string, number> = {};

  for (const [counterType, rawAmount] of Object.entries(deltas)) {
    let amount = rawAmount;
    if (amount === 0) continue;

    if (amount > 0) {
      const effects = counterEffectsForType(counterType, overlaySpecs, targetController);
      if (effects.length > 0) {
        amount = applyCounterPreferenceOrdering(gameState, targetController, amount, effects);
      }
    }

    modified[counterType] = amount;
  }

  return modified;
}
