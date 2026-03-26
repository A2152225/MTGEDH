import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleEffectStep } from './oracleIR';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import {
  applyTemporaryPowerToughnessModifier,
  applyTemporarySetBasePowerToughness,
  resolveCreatureTargetIds,
  resolveSingleCreatureTargetId,
  resolveTrepanationBoostTargetCreatureId,
} from './oracleIRExecutorCreatureStepUtils';

export type ModifyPtRuntime = {
  readonly lastRevealedCardCount?: number;
  readonly lastDiscardedCardCount?: number;
  readonly lastDiscardedCards?: readonly any[];
  readonly lastExiledCardCount?: number;
  readonly lastExiledCards?: readonly any[];
  readonly lastMovedCards?: readonly any[];
  readonly lastGoadedCreatures?: readonly BattlefieldPermanent[];
  readonly lastSacrificedCreaturesPowerTotal?: number;
  readonly lastSacrificedPermanents?: readonly LastKnownPermanentSnapshot[];
  readonly lastExcessDamageDealtThisWay?: number;
  readonly lastScryLookedAtCount?: number;
  readonly lastTappedMatchingPermanentCount?: number;
};

type StepApplyResult = {
  readonly kind: 'applied';
  readonly state: GameState;
  readonly log: readonly string[];
};

type StepRecordedSkipResult = {
  readonly kind: 'recorded_skip';
  readonly message: string;
  readonly reason:
    | 'no_deterministic_target'
    | 'unsupported_where_clause'
    | 'unsupported_condition_clause'
    | 'unsupported_scaler'
    | 'target_not_on_battlefield';
};

type StepUnrecordedSkipResult = {
  readonly kind: 'unrecorded_skip';
  readonly log: string;
};

export type ModifyPtStepHandlerResult = StepApplyResult | StepRecordedSkipResult | StepUnrecordedSkipResult;

export function applyModifyPtStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_pt' }>,
  ctx: OracleIRExecutionContext,
  controllerId: PlayerID,
  runtime: ModifyPtRuntime,
  evaluateWhereX: (
    state: GameState,
    controllerId: PlayerID,
    whereRaw: string,
    targetCreatureId?: string,
    ctx?: OracleIRExecutionContext,
    runtime?: ModifyPtRuntime
  ) => number | null,
  evaluateCondition: (
    state: GameState,
    controllerId: PlayerID,
    conditionRaw: string
  ) => boolean | null
): ModifyPtStepHandlerResult {
  const targetCreatureIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetCreatureIds.length === 0) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  let whereXValue: number | null = null;

  if (step.condition) {
    if (step.condition.kind === 'where') {
      whereXValue = evaluateWhereX(
        state,
        controllerId,
        step.condition.raw,
        targetCreatureIds[0],
        ctx,
        runtime
      );
      if (whereXValue === null) {
        return {
          kind: 'recorded_skip',
          message: `Skipped P/T modifier (unsupported where-clause): ${step.raw}`,
          reason: 'unsupported_where_clause',
        };
      }
    } else {
      const condition = evaluateCondition(state, controllerId, step.condition.raw);
      if (condition === null) {
        return {
          kind: 'recorded_skip',
          message: `Skipped P/T modifier (unsupported condition clause): ${step.raw}`,
          reason: 'unsupported_condition_clause',
        };
      }

      if (!condition) {
        return {
          kind: 'unrecorded_skip',
          log: `Skipped P/T modifier (condition false): ${step.raw}`,
        };
      }
    }
  }

  if (step.scaler?.kind === 'unknown') {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
      reason: 'unsupported_scaler',
    };
  }

  const scale = step.scaler?.kind === 'per_revealed_this_way'
    ? Math.max(0, runtime.lastRevealedCardCount | 0)
    : 1;

  if ((step.powerUsesX || step.toughnessUsesX) && whereXValue === null) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (X used without supported where-clause): ${step.raw}`,
      reason: 'unsupported_where_clause',
    };
  }

  const basePower = step.powerUsesX ? ((step.power | 0) * (whereXValue ?? 0)) : (step.power | 0);
  const baseToughness = step.toughnessUsesX ? ((step.toughness | 0) * (whereXValue ?? 0)) : (step.toughness | 0);
  const powerBonus = basePower * scale;
  const toughnessBonus = baseToughness * scale;

  let nextState: GameState | null = state;
  for (const targetCreatureId of targetCreatureIds) {
    nextState = applyTemporaryPowerToughnessModifier(
      nextState,
      targetCreatureId,
      ctx,
      powerBonus,
      toughnessBonus,
      step.scaler?.kind === 'per_revealed_this_way'
    );

    if (!nextState) {
      return {
        kind: 'recorded_skip',
        message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
        reason: 'target_not_on_battlefield',
      };
    }
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [`${targetCreatureIds.length} creature(s) get +${powerBonus}/+${toughnessBonus} until end of turn`],
  };
}

export function applyModifyPtPerRevealedStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'modify_pt_per_revealed' }>,
  ctx: OracleIRExecutionContext,
  lastRevealedCardCount: number
): ModifyPtStepHandlerResult {
  const targetCreatureId = resolveTrepanationBoostTargetCreatureId(state, ctx);
  if (!targetCreatureId) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const revealed = Math.max(0, lastRevealedCardCount | 0);
  const powerBonus = revealed * (step.powerPerCard | 0);
  const toughnessBonus = revealed * (step.toughnessPerCard | 0);

  const nextState = applyTemporaryPowerToughnessModifier(
    state,
    targetCreatureId,
    ctx,
    powerBonus,
    toughnessBonus,
    true
  );
  if (!nextState) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
      reason: 'target_not_on_battlefield',
    };
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [`${targetCreatureId} gets +${powerBonus}/+${toughnessBonus} until end of turn`],
  };
}

export function applySetBasePtStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'set_base_pt' }>,
  ctx: OracleIRExecutionContext
): ModifyPtStepHandlerResult {
  const targetCreatureId = resolveSingleCreatureTargetId(state, step.target, ctx);
  if (!targetCreatureId) {
    return {
      kind: 'recorded_skip',
      message: `Skipped base P/T setter (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextState = applyTemporarySetBasePowerToughness(
    state,
    targetCreatureId,
    ctx,
    step.power | 0,
    step.toughness | 0
  );
  if (!nextState) {
    return {
      kind: 'recorded_skip',
      message: `Skipped base P/T setter (target not on battlefield): ${step.raw}`,
      reason: 'target_not_on_battlefield',
    };
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [`${targetCreatureId} has base power and toughness ${step.power}/${step.toughness} until end of turn`],
  };
}
