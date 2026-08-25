// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyExertStep, applyBecomeRenownedStep, applyMonstrosityStep.
// Public entries: those three apply* functions.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { applyTemporaryEffectToPermanents } from './oracleIRExecutorBattlefieldTemporaryEffects';
import { quantityToNumber } from './oracleIRExecutorPlayerUtils';
import { trySpecialExertStep } from './oracleIRExecutorSpecialTargetHandlers';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function applyExertStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'exert' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const special = trySpecialExertStep(state, step, ctx, runtime);
  if (special) return special;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step) || ({ kind: 'raw', text: 'this permanent' } as const);
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, effectiveTarget as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped exert (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (targetIds.length > 1 && /^target\b/i.test(String((step.target as any)?.text || '').trim())) {
    return {
      applied: false,
      message: `Skipped exert (needs player choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const controllerId = (String(ctx.controllerId || '').trim() || ctx.controllerId) as PlayerID;
  const targets = battlefield.filter((perm: any) => targetIds.includes(String((perm as any)?.id || '').trim()));
  const nextState = applyTemporaryEffectToPermanents(state, targets, ctx, {
    descriptions: ["doesn't untap during your next untap step"],
    expiresAt: 'leaves_battlefield',
    expiresOnControllerTurn: controllerId,
  });

  return {
    applied: true,
    state: nextState,
    log: [`Exerted ${targets.length} permanent(s)`],
  };
}

export {
  applyAirbendStep,
  applyEarthbendStep,
  applyAnimatePermanentStep,
} from './oracleIRExecutorBattlefieldBendAndAnimateSteps';


export function applyBecomeRenownedStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'become_renowned' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, step.target as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, step.target as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped become renowned (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    return {
      ...perm,
      isRenowned: true,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${targetIds.length} permanent(s) became renowned`],
  };
}

export { applyGainClassLevelStep } from './oracleIRExecutorBattlefieldGainClassLevelStep';

export function applyMonstrosityStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'monstrosity' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime
): BattlefieldStepHandlerResult {
  const amountValue =
    step.amount.kind === 'number'
      ? step.amount.value
      : step.amount.kind === 'x'
        ? Number(ctx.xValue)
        : quantityToNumber(step.amount, ctx);
  if (amountValue === null || !Number.isFinite(Number(amountValue)) || Number(amountValue) <= 0) {
    const fallback = Number.isFinite(Number(ctx.xValue)) ? Number(ctx.xValue) : 1;
    if (fallback <= 0) {
      return {
        applied: false,
        message: `Skipped monstrosity (unsupported amount): ${step.raw}`,
        reason: 'unsupported_target',
      };
    }
  }
  const resolvedAmount = Number(amountValue) > 0 ? Number(amountValue) : Number(ctx.xValue) || 1;

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step) || ({ kind: 'raw', text: 'this permanent' } as const);
  const recentTargets = resolveRecentlyMovedBattlefieldPermanents(battlefield, effectiveTarget as any, runtime);
  const directTargets = recentTargets.length > 0 ? [] : resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  const targetIds = Array.from(
    new Set(
      [...recentTargets, ...directTargets]
        .map((perm: any) => String((perm as any)?.id || '').trim())
        .filter(Boolean)
    )
  );

  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped monstrosity (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let newlyMonstrousCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;

    const isAlreadyMonstrous =
      typeof (perm as any)?.isMonstrous === 'boolean'
        ? Boolean((perm as any).isMonstrous)
        : typeof (perm as any)?.monstrous === 'boolean'
          ? Boolean((perm as any).monstrous)
          : false;
    if (isAlreadyMonstrous) return perm;

    newlyMonstrousCount += 1;
    return {
      ...perm,
      counters: {
        ...(((perm as any)?.counters || {}) as Record<string, number>),
        '+1/+1': Math.max(0, Number(((perm as any)?.counters || {})['+1/+1'] || 0)) + resolvedAmount,
      },
      isMonstrous: true,
      monstrosityX: resolvedAmount,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log:
      newlyMonstrousCount > 0
        ? [`${newlyMonstrousCount} permanent(s) became monstrous`]
        : ['Monstrosity had no effect on already monstrous permanent(s)'],
  };
}

