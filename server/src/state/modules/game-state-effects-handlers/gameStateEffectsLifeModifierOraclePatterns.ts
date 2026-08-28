// Origin parent: server/src/state/modules/game-state-effects-handlers/gameStateEffectsWinLose.ts
// Cluster moved: LIFE_MODIFIERS card-name table → generic oracle-pattern
//   restrictions + ReplacementEffectSpec life-gain collect/apply.
// Public entry symbols: detectLifeModifiers, canLifeChange, canGainLife,
//   lifeGainBecomesLoss, canPlayerPayLife, processLifeChange.
// Leaf must not import game-state-effects.ts or game-state-effects-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { evaluateLifeGainReplacementEvent, evaluateLifeLossReplacementEvent } from "../replacement-effects.js";
import {
  collectOraclePatternLifeGainReplacementSpecsFromState,
  overlaySpecsMatchLifeGain,
} from "../replacementEffectSpec.js";
import { normalizeOraclePatternText, readCardOracleText } from "../replacementEffectSpec-handlers/replacementEffectSpecOracleTextUtils.js";
import { getActivePermanents } from "./gameStateEffectsBattlefieldQueries.js";
import {
  applyLifeGainReplacements,
  applyLifeLossReplacements,
  getReplacementEffectMode,
  getReplacementEffectPreference,
} from "./gameStateEffectsReplacementApply.js";

export interface LifeModifier {
  permanentId: string;
  cardName: string;
  /** `cant_lose` here means "can't pay life" (Angel of Jubilation family), not can't-lose-the-game. */
  type: 'cant_change' | 'cant_gain' | 'gain_becomes_loss' | 'cant_lose' | 'damage_doubled';
  affectsController: boolean;
  affectsOpponents: boolean;
  expiresAtCleanup?: boolean;
}

function isAlchemyLifeModifierSource(name: unknown): boolean {
  return /^A-/i.test(String(name || '').trim());
}

function stateFromCtx(ctx: GameContext): unknown {
  return (ctx as { state?: unknown }).state || ctx;
}

function specAppliesToPlayer(spec: { match?: unknown; sourceController?: string }, playerId: string, state: unknown): boolean {
  return overlaySpecsMatchLifeGain(spec as Parameters<typeof overlaySpecsMatchLifeGain>[0], {
    playerId,
    state,
    amount: 1,
  });
}

function polarityForController(isController: boolean, affectsController: boolean, affectsOpponents: boolean): boolean {
  return (affectsController && isController) || (affectsOpponents && !isController);
}

function classifyLifeTotalCantChange(oracle: string): { affectsController: boolean; affectsOpponents: boolean } | null {
  if (!oracle.includes("life total can't change") && !oracle.includes("life totals can't change")) {
    return null;
  }
  if (oracle.includes("your life total can't change")) {
    return { affectsController: true, affectsOpponents: false };
  }
  if (oracle.includes("players") && oracle.includes("life totals can't change")) {
    return { affectsController: true, affectsOpponents: true };
  }
  return { affectsController: true, affectsOpponents: false };
}

function classifyCantPayLife(oracle: string): { affectsController: boolean; affectsOpponents: boolean } | null {
  const playersCantPay = oracle.includes("players can't pay life");
  const opponentsCantPay = oracle.includes("your opponents") && oracle.includes("can't pay life");
  const youCantPayExceptZero = oracle.includes("you can't pay any amount of life");
  if (!playersCantPay && !opponentsCantPay && !youCantPayExceptZero) return null;
  if (opponentsCantPay && !playersCantPay) {
    return { affectsController: false, affectsOpponents: true };
  }
  if (youCantPayExceptZero && !playersCantPay) {
    return { affectsController: true, affectsOpponents: false };
  }
  return { affectsController: true, affectsOpponents: true };
}

function pushUniqueModifier(modifiers: LifeModifier[], next: LifeModifier): void {
  const exists = modifiers.some((entry) =>
    entry.permanentId === next.permanentId && entry.type === next.type,
  );
  if (!exists) modifiers.push(next);
}

/**
 * Detect life-total / life-gain / pay-life modifiers from oracle + the
 * `playerProtection[playerId].lifeCannotChange` runtime flag.
 * No card-name routing. Wound Reflection's current oracle is an end-step
 * trigger, not a life-loss replacement — it does not appear here.
 */
export function detectLifeModifiers(ctx: GameContext, playerId: string): LifeModifier[] {
  const modifiers: LifeModifier[] = [];
  const state = stateFromCtx(ctx);
  const battlefield = getActivePermanents(ctx);

  for (const perm of battlefield) {
    const card = perm?.card;
    const sourceName = String(card?.name || perm?.name || '').trim();
    if (!card || isAlchemyLifeModifierSource(sourceName)) continue;
    const oracle = normalizeOraclePatternText(readCardOracleText(card));
    if (!oracle) continue;
    const permanentId = String(perm.id || '').trim();
    if (!permanentId) continue;
    const isController = String(perm.controller || '') === playerId;

    const cantChange = classifyLifeTotalCantChange(oracle);
    if (cantChange && polarityForController(isController, cantChange.affectsController, cantChange.affectsOpponents)) {
      pushUniqueModifier(modifiers, {
        permanentId,
        cardName: sourceName || 'Permanent',
        type: 'cant_change',
        ...cantChange,
      });
    }

    const cantPay = classifyCantPayLife(oracle);
    if (cantPay && polarityForController(isController, cantPay.affectsController, cantPay.affectsOpponents)) {
      pushUniqueModifier(modifiers, {
        permanentId,
        cardName: sourceName || 'Permanent',
        type: 'cant_lose',
        ...cantPay,
      });
    }
  }

  for (const spec of collectOraclePatternLifeGainReplacementSpecsFromState(state)) {
    if (!specAppliesToPlayer(spec, playerId, state)) continue;
    const permanentId = String(spec.sourcePermanentId || '').trim();
    const cardName = String(spec.sourceName || 'Permanent').trim() || 'Permanent';
    if (!permanentId) continue;
    const isController = String(spec.sourceController || '') === playerId;
    if (spec.reason === 'life_total_cant_change') {
      pushUniqueModifier(modifiers, {
        permanentId,
        cardName,
        type: 'cant_change',
        affectsController: isController,
        affectsOpponents: !isController,
      });
      continue;
    }
    if (spec.instead.replaceLifeGainWith === 'none') {
      pushUniqueModifier(modifiers, {
        permanentId,
        cardName,
        type: 'cant_gain',
        affectsController: isController,
        affectsOpponents: !isController,
      });
    } else if (spec.instead.replaceLifeGainWith === 'loss') {
      pushUniqueModifier(modifiers, {
        permanentId,
        cardName,
        type: 'gain_becomes_loss',
        affectsController: isController,
        affectsOpponents: !isController,
      });
    }
  }

  const lastingEffects = Array.isArray((state as { lastingEffects?: unknown[] })?.lastingEffects)
    ? (state as { lastingEffects: unknown[] }).lastingEffects
    : [];
  for (const entry of lastingEffects) {
    const effect = entry as { type?: string; targetPlayer?: string; source?: string };
    if (effect?.type !== 'preventLifeGain') continue;
    if (String(effect?.targetPlayer || '') !== String(playerId)) continue;
    const source = String(effect?.source || 'This-turn lock').trim() || 'This-turn lock';
    if (isAlchemyLifeModifierSource(source)) continue;
    pushUniqueModifier(modifiers, {
      permanentId: `lasting_prevent_life_gain:${playerId}`,
      cardName: source,
      type: 'cant_gain',
      affectsController: true,
      affectsOpponents: false,
      expiresAtCleanup: true,
    });
  }

  const protection = ctx.state?.playerProtection?.[playerId];
  if (protection?.lifeCannotChange) {
    pushUniqueModifier(modifiers, {
      permanentId: 'player_protection_life_cannot_change',
      cardName: "Life total can't change",
      type: 'cant_change',
      affectsController: true,
      affectsOpponents: false,
      expiresAtCleanup: true,
    });
  }

  return modifiers;
}

export function canLifeChange(ctx: GameContext, playerId: string): boolean {
  return !detectLifeModifiers(ctx, playerId).some((modifier) => modifier.type === 'cant_change');
}

export function canGainLife(ctx: GameContext, playerId: string): boolean {
  return !detectLifeModifiers(ctx, playerId).some(
    (modifier) => modifier.type === 'cant_gain' || modifier.type === 'cant_change',
  );
}

export function lifeGainBecomesLoss(ctx: GameContext, playerId: string): boolean {
  return detectLifeModifiers(ctx, playerId).some((modifier) => modifier.type === 'gain_becomes_loss');
}

/** Restriction: player cannot pay life as a cost (Angel of Jubilation / life-total-can't-change). */
export function canPlayerPayLife(ctx: GameContext, playerId: string): boolean {
  if (!canLifeChange(ctx, playerId)) return false;
  return !detectLifeModifiers(ctx, playerId).some((modifier) => modifier.type === 'cant_lose');
}

function reverseLifeGainSourceNames(ctx: GameContext, playerId: string): string[] {
  const state = stateFromCtx(ctx);
  return collectOraclePatternLifeGainReplacementSpecsFromState(state)
    .filter((spec) => spec.instead.replaceLifeGainWith === 'loss' && specAppliesToPlayer(spec, playerId, state))
    .map((spec) => String(spec.sourceName || '').trim().toLowerCase())
    .filter(Boolean);
}

function isLifeGainReversed(result: { replacementAmount?: number; metadata?: Record<string, unknown>; reason?: string }): boolean {
  if (result.metadata?.reversedToLoss === true) return true;
  if (result.reason === 'life_gain_reversed_to_loss') return true;
  return Number(result.replacementAmount || 0) < 0;
}

function isLifeGainPrevented(result: { replacementAmount?: number; preventedAmount?: number }): boolean {
  const replacement = Number(result.replacementAmount ?? 1);
  const prevented = Number(result.preventedAmount || 0);
  return replacement === 0 && prevented > 0;
}

/**
 * Process a life-gain or life-loss event. Life-gain prevent/reverse and
 * life-loss doubles use ReplacementEffectSpec collect/apply (no card-name table).
 */
export function processLifeChange(
  ctx: GameContext,
  playerId: string,
  amount: number,
  isGain: boolean,
): { finalAmount: number; prevented: boolean; reason?: string } {
  if (!canLifeChange(ctx, playerId)) {
    return { finalAmount: 0, prevented: true, reason: "Life total can't change" };
  }

  const state = stateFromCtx(ctx);

  if (!isGain) {
    const replacement = evaluateLifeLossReplacementEvent({
      state,
      playerId,
      amount,
    });
    if (replacement.applied && Number.isFinite(Number(replacement.replacementAmount))) {
      return { finalAmount: Math.max(0, Number(replacement.replacementAmount)), prevented: false };
    }
    const lossResult = applyLifeLossReplacements(ctx, amount, playerId);
    return { finalAmount: lossResult.finalAmount, prevented: false };
  }

  const replacement = evaluateLifeGainReplacementEvent({
    state,
    playerId,
    amount,
  });

  if (replacement.applied && isLifeGainReversed(replacement)) {
    const pref = getReplacementEffectPreference(ctx, playerId, 'life_gain');
    const mode = getReplacementEffectMode(pref, 'life_gain');

    if (mode === 'maximize') {
      const { finalAmount } = applyLifeGainReplacements(ctx, amount, playerId);
      return { finalAmount: -finalAmount, prevented: false, reason: 'Life gain becomes life loss' };
    }

    if (mode === 'custom' && Array.isArray(pref?.customOrder) && pref.customOrder.length > 0) {
      const reverseNames = new Set(reverseLifeGainSourceNames(ctx, playerId));
      const idx = pref.customOrder.findIndex((entry) => reverseNames.has(String(entry).toLowerCase()));
      if (idx > 0) {
        const { finalAmount } = applyLifeGainReplacements(ctx, amount, playerId);
        return { finalAmount: -finalAmount, prevented: false, reason: 'Life gain becomes life loss' };
      }
    }

    const reversed = Number(replacement.originalAmount ?? amount);
    return { finalAmount: -reversed, prevented: false, reason: 'Life gain becomes life loss' };
  }

  if (replacement.applied && isLifeGainPrevented(replacement)) {
    return { finalAmount: 0, prevented: true, reason: "Can't gain life" };
  }

  const gainResult = applyLifeGainReplacements(ctx, amount, playerId);
  return { finalAmount: gainResult.finalAmount, prevented: false };
}
