import type { PlayerID } from '../../../../shared/src';
import {
  applyBeneficialReplacements,
  applyReplacementsCustomOrder,
  type ReplacementEffect,
} from './game-state-effects.js';
import type { ReplacementEffectSpec } from './replacementEffectSpec.js';
import { overlayReplacementSpecToEffect, overlaySpecsMatchCounterPlacement } from './replacementEffectSpec.js';

interface CounterModifier {
  permanentId: string;
  cardName: string;
  controller: PlayerID;
  doublesYourCounters: boolean;
  halvesOpponentCounters: boolean;
  addsBonusCounter: number;
}

function detectCounterModifiers(gameState: any, targetPermanentController: PlayerID): CounterModifier[] {
  const modifiers: CounterModifier[] = [];
  const battlefield = gameState?.battlefield || [];

  for (const perm of battlefield) {
    if (!perm?.card) continue;
    const cardName = (perm.card.name || '').toLowerCase();
    const oracleText = (perm.card.oracle_text || '').toLowerCase();
    const controller = perm.controller;

    if (cardName.includes('vorinclex') && (cardName.includes('monstrous raider') || oracleText.includes('put twice that many'))) {
      modifiers.push({
        permanentId: perm.id,
        cardName: perm.card.name,
        controller,
        doublesYourCounters: controller === targetPermanentController,
        halvesOpponentCounters: controller !== targetPermanentController,
        addsBonusCounter: 0,
      });
    }

    if (cardName.includes('doubling season') || (oracleText.includes('twice that many') && oracleText.includes('counter') && oracleText.includes('permanent you control'))) {
      if (controller === targetPermanentController) {
        modifiers.push({
          permanentId: perm.id,
          cardName: perm.card.name,
          controller,
          doublesYourCounters: true,
          halvesOpponentCounters: false,
          addsBonusCounter: 0,
        });
      }
    }

    if (cardName.includes('hardened scales') || (oracleText.includes('that many plus one') && oracleText.includes('+1/+1 counter'))) {
      if (controller === targetPermanentController) {
        modifiers.push({
          permanentId: perm.id,
          cardName: perm.card.name,
          controller,
          doublesYourCounters: false,
          halvesOpponentCounters: false,
          addsBonusCounter: 1,
        });
      }
    }

    if (cardName.includes('branching evolution') || (oracleText.includes('double that amount') && oracleText.includes('+1/+1 counter'))) {
      if (controller === targetPermanentController) {
        modifiers.push({
          permanentId: perm.id,
          cardName: perm.card.name,
          controller,
          doublesYourCounters: true,
          halvesOpponentCounters: false,
          addsBonusCounter: 0,
        });
      }
    }

    if (cardName.includes('primal vigor') && oracleText.includes('twice that many')) {
      modifiers.push({
        permanentId: perm.id,
        cardName: perm.card.name,
        controller,
        doublesYourCounters: true,
        halvesOpponentCounters: false,
        addsBonusCounter: 0,
      });
    }
  }

  return modifiers;
}

function counterEffectsForType(
  modifiers: CounterModifier[],
  counterType: string,
  overlaySpecs: readonly ReplacementEffectSpec[],
  targetController: PlayerID,
): ReplacementEffect[] {
  const effects: ReplacementEffect[] = [];

  for (const mod of modifiers) {
    if (mod.halvesOpponentCounters) {
      effects.push({ type: 'halve', source: mod.cardName, controllerId: mod.controller });
    }
    if (mod.doublesYourCounters) {
      effects.push({ type: 'double', source: mod.cardName, controllerId: mod.controller });
    }
    if (counterType.includes('+1/+1') && mod.addsBonusCounter > 0) {
      effects.push({ type: 'add_flat', value: mod.addsBonusCounter, source: mod.cardName, controllerId: mod.controller });
    }
  }

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
  const modifiers = detectCounterModifiers(gameState, targetController);
  if (modifiers.length === 0 && overlaySpecs.length === 0) return deltas;

  const modified: Record<string, number> = {};

  for (const [counterType, rawAmount] of Object.entries(deltas)) {
    let amount = rawAmount;
    if (amount === 0) continue;

    if (amount > 0) {
      const effects = counterEffectsForType(modifiers, counterType, overlaySpecs, targetController);
      if (effects.length > 0) {
        amount = applyCounterPreferenceOrdering(gameState, targetController, amount, effects);
      }
    }

    modified[counterType] = amount;
  }

  return modified;
}
