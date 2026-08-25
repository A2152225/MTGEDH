// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: applyGainClassLevelStep.
// Public entry: applyGainClassLevelStep.

import type { GameState, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { BattlefieldStepHandlerResult } from './oracleIRExecutorBattlefieldStepTypes';

export function applyGainClassLevelStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'gain_class_level' }>,
  ctx: OracleIRExecutionContext
): BattlefieldStepHandlerResult {
  // Bare "Level N" is the printed effect of Class level abilities (e.g. "{W}: Level 2").
  // Apply it — do not treat it as a section header no-op.
  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) {
    return {
      applied: false,
      message: `Skipped gain class level (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const battlefield = (state.battlefield || []) as BattlefieldPermanent[];
  const sourcePermanent = battlefield.find((perm: any) => String((perm as any)?.id || '').trim() === sourceId);
  if (!sourcePermanent) {
    return {
      applied: false,
      message: `Skipped gain class level (source not on battlefield): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const targetLevel = Number(step.level);
  if (!Number.isFinite(targetLevel) || targetLevel < 1) {
    return {
      applied: false,
      message: `Skipped gain class level (unsupported level): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const currentLevelRaw = Number((sourcePermanent as any)?.level);
  const currentLevel = Number.isFinite(currentLevelRaw) && currentLevelRaw >= 1
    ? Math.floor(currentLevelRaw)
    : 1;
  if (targetLevel <= currentLevel) {
    return {
      applied: true,
      state,
      log: [`Class level already at least ${targetLevel}`],
    };
  }
  if (targetLevel !== currentLevel + 1) {
    return {
      applied: false,
      message: `Skipped gain class level (impossible progression): ${step.raw}`,
      reason: 'impossible_action',
    };
  }

  const nextBattlefield = battlefield.map((perm: any) => {
    if (String((perm as any)?.id || '').trim() !== sourceId) return perm;
    return {
      ...perm,
      level: targetLevel,
    } as BattlefieldPermanent;
  });

  return {
    applied: true,
    state: {
      ...(state as any),
      battlefield: nextBattlefield as any,
    } as GameState,
    log: [`${String((sourcePermanent as any)?.card?.name || 'Source permanent')} reached Class level ${targetLevel}`],
  };
}

