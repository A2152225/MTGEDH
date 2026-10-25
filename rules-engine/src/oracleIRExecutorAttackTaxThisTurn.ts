/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: this-turn / until-next-turn grant_static_ability attack-tax
 *   stamps state.lastingEffects attackTaxGeneric. Cleanup expires this_turn
 *   (missing duration = this-turn). until_your_next_turn lasts until the
 *   source controller's next turn. Continuous pillowfort stays StaticEffectSpec.
 * Public: tryApplyAttackTaxThisTurnGrant
 * Leaf must not import oracleIRExecutorMainLoop.ts or oracleIRExecutorBattlefieldStepHandlers.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

const TAX_DURATIONS = new Set(['this_turn', 'until_next_turn']);

function isAlchemySourceName(name: unknown): boolean {
  return /^A-/i.test(String(name || '').trim());
}

function grantEffectText(step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>): string {
  return [
    ...(Array.isArray(step.effectText) ? step.effectText : []),
    ...(Array.isArray(step.abilities) ? step.abilities : []),
  ]
    .map((entry) => String(entry || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');
}

function resolveTaxAmount(
  effectText: string,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): { generic: number; life: number } | null {
  const life = effectText.match(/pays\s+(\d+)\s+life/i);
  if (life) {
    const parsed = Number.parseInt(String(life[1] || ''), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return { generic: 0, life: parsed };
  }
  const mana = effectText.match(/\{(x|\d+)\}/i);
  if (!mana) return null;
  if (String(mana[1] || '').toLowerCase() === 'x') {
    const fromStep = Number((step as { xValue?: number }).xValue);
    const fromCtx = Number(ctx.xValue);
    const resolved = Number.isFinite(fromStep) ? fromStep : fromCtx;
    if (!Number.isFinite(resolved)) return { generic: 0, life: 0 };
    return { generic: Math.max(0, Math.floor(resolved)), life: 0 };
  }
  const parsed = Number.parseInt(String(mana[1] || ''), 10);
  if (!Number.isFinite(parsed)) return null;
  return { generic: Math.max(0, parsed), life: 0 };
}

function currentTurnNumber(state: GameState): number {
  const turn = Number((state as { turnNumber?: number; turn?: number }).turnNumber
    ?? (state as { turn?: number }).turn
    ?? 0);
  return Number.isFinite(turn) ? turn : 0;
}

export function tryApplyAttackTaxThisTurnGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (!TAX_DURATIONS.has(duration)) return null;

  const effectText = grantEffectText(step);
  if (!effectText.includes("can't attack") && !effectText.includes('cannot attack')) {
    return null;
  }
  if (!effectText.includes('unless') || !effectText.includes('pays')) {
    return null;
  }

  const sourceName = String(ctx.sourceName || '').trim();
  if (isAlchemySourceName(sourceName)) {
    return {
      applied: true,
      state,
      log: [`Skipped Alchemy this-turn attack tax: ${step.raw}`],
    };
  }

  const amount = resolveTaxAmount(effectText, step, ctx);
  if (amount === null) return null;
  if (amount.generic <= 0 && amount.life <= 0) {
    return {
      applied: true,
      state,
      log: [`Skipped zero this-turn attack tax: ${step.raw}`],
    };
  }

  const attackYou = /\bcan(?:not|'t)\s+attack\s+you\b/.test(effectText);
  const source = sourceName || 'This-turn attack tax';
  const existing = Array.isArray(state.lastingEffects)
    ? [...state.lastingEffects]
    : [];

  const stamp = amount.life > 0
    ? {
        type: 'attackTaxLife',
        duration: duration === 'until_next_turn' ? 'until_your_next_turn' : 'this_turn',
        amount: amount.life,
        defenderId: String(ctx.controllerId || '').trim(),
        global: false,
        source,
        controllerId: String(ctx.controllerId || '').trim() || undefined,
        turnApplied: currentTurnNumber(state),
      }
    : attackYou
    ? {
        type: 'attackTaxGeneric',
        duration: duration === 'until_next_turn' ? 'until_your_next_turn' : 'this_turn',
        amount: amount.generic,
        defenderId: String(ctx.controllerId || '').trim(),
        global: false,
        source,
        controllerId: String(ctx.controllerId || '').trim() || undefined,
        turnApplied: currentTurnNumber(state),
      }
    : {
        type: 'attackTaxGeneric',
        duration: 'this_turn',
        amount: amount.generic,
        global: true,
        source,
      };

  return {
    applied: true,
    state: {
      ...state,
      lastingEffects: [...existing, stamp],
    },
    log: [`Stamped ${stamp.duration} ${stamp.type} ${amount.life || amount.generic} (${stamp.global ? 'global' : 'attack_you'})`],
  };
}
