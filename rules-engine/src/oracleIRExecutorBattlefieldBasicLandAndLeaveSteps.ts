// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applySetBasicLandTypeStep, applyGrantLeaveBattlefieldReplacementStep.
// Public entries: those two apply* functions.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import {
  normalizeBasicLandTypeName,
  setPermanentBasicLandType,
} from './oracleIRExecutorBattlefieldBasicLandType';
import { resolveDirectBattlefieldPermanents } from './oracleIRExecutorBattlefieldPermanentSelectors';
import { resolveRecentlyMovedBattlefieldPermanents } from './oracleIRExecutorBattlefieldRecentlyMoved';
import { effectiveStepTarget } from './oracleIRExecutorExtendedTargetResolution';

export function applySetBasicLandTypeStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'set_basic_land_type' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const effectiveTarget = effectiveStepTarget(step);
  const targets = resolveDirectBattlefieldPermanents(battlefield, effectiveTarget as any, ctx);
  if (targets.length === 0) {
    return {
      applied: false,
      message: `Skipped basic land type change (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const chosenLandType = step.landType === 'choice'
    ? normalizeBasicLandTypeName(ctx.selectorContext?.chosenBasicLandType)
    : normalizeBasicLandTypeName(step.landType);
  if (!chosenLandType) {
    return {
      applied: false,
      message: `Skipped basic land type change (requires basic land type choice): ${step.raw}`,
      reason: 'player_choice_required',
      options: { classification: 'player_choice' },
    };
  }

  const targetIds = new Set(targets.map((perm: any) => String((perm as any)?.id || '').trim()).filter(Boolean));
  let changedCount = 0;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.has(permanentId)) return perm;
    changedCount += 1;
    return setPermanentBasicLandType(perm, chosenLandType, step.duration, ctx);
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${changedCount} permanent(s) became ${chosenLandType}`],
  };
}

export {
  applyExchangeControlStep,
  applyCopyPermanentStep,
} from './oracleIRExecutorBattlefieldExchangeAndCopySteps';

export { applyScheduleDelayedTriggerStep } from './oracleIRExecutorBattlefieldDelayedTriggerSteps';

export function applyGrantLeaveBattlefieldReplacementStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'grant_leave_battlefield_replacement' }>,
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
      message: `Skipped leave-battlefield replacement grant (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String((perm as any)?.id || '').trim();
    if (!targetIds.includes(permanentId)) return perm;
    const nextPerm = {
      ...perm,
      leaveBattlefieldReplacement: step.destination,
      ...(step.destination === 'exile'
        ? {
            leaveBattlefieldReplacementDestination: 'exile',
            card: {
              ...((perm as any)?.card || {}),
              leaveBattlefieldReplacementDestination: 'exile',
            },
          }
        : {}),
    } as BattlefieldPermanent;
    return nextPerm;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`Granted leave-battlefield ${step.destination} replacement to ${targetIds.length} permanent(s)`],
  };
}

