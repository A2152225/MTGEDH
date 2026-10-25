/**
 * Origin parent: oracleIRExecutorBattlefieldGrantStaticAbilityStep.ts
 * Cluster: this-turn grant_static_ability block-tax stamps
 *   state.lastingEffects blockTaxGeneric (War Cadence). Cleanup expires
 *   this_turn (missing duration = this-turn). Continuous Archangel stays
 *   StaticEffectSpec.
 * Public: tryApplyBlockTaxThisTurnGrant
 * Leaf must not import oracleIRExecutorMainLoop.ts or oracleIRExecutorBattlefieldStepHandlers.ts.
 */

import type { GameState } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

const TAX_DURATIONS = new Set(['this_turn']);

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
): number | null {
  const mana = effectText.match(/\{(x|\d+)\}/i);
  if (!mana) return null;
  if (String(mana[1] || '').toLowerCase() === 'x') {
    const fromStep = Number((step as { xValue?: number }).xValue);
    const fromCtx = Number(ctx.xValue);
    const resolved = Number.isFinite(fromStep) ? fromStep : fromCtx;
    if (!Number.isFinite(resolved)) return 0;
    return Math.max(0, Math.floor(resolved));
  }
  const parsed = Number.parseInt(String(mana[1] || ''), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

export function tryApplyBlockTaxThisTurnGrant(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  ctx: OracleIRExecutionContext,
): BattlefieldStepHandlerResult | null {
  const duration = String(step.duration || 'static').trim();
  if (!TAX_DURATIONS.has(duration)) return null;

  const effectText = grantEffectText(step);
  if (!effectText.includes("can't block") && !effectText.includes('cannot block')) {
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
      log: [`Skipped Alchemy this-turn block tax: ${step.raw}`],
    };
  }

  const amount = resolveTaxAmount(effectText, step, ctx);
  if (amount === null) return null;

  const source = sourceName || 'This-turn block tax';
  const existing = Array.isArray(state.lastingEffects)
    ? [...state.lastingEffects]
    : [];

  const stamp = {
    type: 'blockTaxGeneric',
    duration: 'this_turn',
    amount,
    global: true,
    source,
  };

  return {
    applied: true,
    state: {
      ...state,
      lastingEffects: [...existing, stamp],
    },
    log: [`Stamped this_turn blockTaxGeneric ${amount} (global)`],
  };
}
