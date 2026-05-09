import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleEffectStep } from './oracleIR';
import type { LastKnownPermanentSnapshot } from './oracleIRExecutorLastKnownInfo';
import {
  applyTemporaryPowerToughnessModifier,
  applyTemporarySetBasePowerToughness,
  applyTemporarySwitchPowerToughness,
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
  readonly lastReferenceAmount?: number;
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

function countCreaturesBlockingTarget(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  if (!targetId) return 0;
  const combat: any = (state as any).combat || {};
  const attackerEntry = Array.isArray(combat.attackers)
    ? combat.attackers.find((entry: any) => String(entry?.permanentId || '').trim() === targetId)
    : null;
  if (attackerEntry && Array.isArray(attackerEntry.blockedBy)) {
    return new Set(attackerEntry.blockedBy.map((id: any) => String(id || '').trim()).filter(Boolean)).size;
  }

  if (Array.isArray(combat.blockers)) {
    return combat.blockers.filter((entry: any) =>
      Array.isArray(entry?.blocking) && entry.blocking.some((id: any) => String(id || '').trim() === targetId)
    ).length;
  }

  return 0;
}

function countBasicLandTypesAmongLandsYouControl(state: GameState, controllerId: PlayerID): number {
  const basicLandTypes = new Set(['plains', 'island', 'swamp', 'mountain', 'forest']);
  const found = new Set<string>();
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  for (const permanent of battlefield) {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) continue;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    if (!/\bland\b/i.test(typeLine)) continue;
    for (const basicType of basicLandTypes) {
      if (new RegExp(`\\b${basicType}\\b`, 'i').test(typeLine)) found.add(basicType);
    }
  }
  return found.size;
}

function countArtifactsYouControl(state: GameState, controllerId: PlayerID): number {
  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    if (String(permanent?.controllerId || permanent?.controller || '').trim() !== String(controllerId || '').trim()) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    return /\bartifact\b/i.test(typeLine);
  }).length;
}

function countOtherAttackingAurochs(state: GameState, targetCreatureId: string): number {
  const targetId = String(targetCreatureId || '').trim();
  const combat: any = (state as any).combat || {};
  const attackingIds = Array.isArray(combat.attackers)
    ? combat.attackers.map((entry: any) => String(entry?.permanentId || entry?.id || '').trim()).filter(Boolean)
    : [];
  if (attackingIds.length === 0) return 0;

  const battlefield = Array.isArray((state as any).battlefield) ? (state as any).battlefield : [];
  return battlefield.filter((permanent: any) => {
    const permanentId = String(permanent?.id || permanent?.permanentId || '').trim();
    if (!permanentId || permanentId === targetId || !attackingIds.includes(permanentId)) return false;
    const typeLine = String(permanent?.card?.type_line || permanent?.card?.typeLine || permanent?.type_line || permanent?.typeLine || '').toLowerCase();
    const name = String(permanent?.card?.name || permanent?.name || '').toLowerCase();
    return /\baurochs\b/i.test(typeLine) || /\baurochs\b/i.test(name);
  }).length;
}

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

  if (step.scaler?.kind === 'unknown' || step.scaler?.kind === 'reference_scaler') {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
      reason: 'unsupported_scaler',
    };
  }

  const scale = step.scaler?.kind === 'per_revealed_this_way'
    ? Math.max(0, runtime.lastRevealedCardCount | 0)
    : step.scaler?.kind === 'per_creature_blocking_it'
      ? Math.max(0, countCreaturesBlockingTarget(state, targetCreatureIds[0]))
      : step.scaler?.kind === 'per_basic_land_type_among_lands_you_control'
        ? Math.max(0, countBasicLandTypesAmongLandsYouControl(state, controllerId))
        : step.scaler?.kind === 'per_artifact_you_control'
          ? Math.max(0, countArtifactsYouControl(state, controllerId))
          : step.scaler?.kind === 'per_creature_tapped_this_way'
            ? Math.max(0, runtime.lastTappedMatchingPermanentCount | 0)
            : step.scaler?.kind === 'per_other_attacking_aurochs'
              ? Math.max(0, countOtherAttackingAurochs(state, targetCreatureIds[0]))
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

export function applySwitchPowerToughnessStep(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'switch_power_toughness' }>,
  ctx: OracleIRExecutionContext
): ModifyPtStepHandlerResult {
  const targetCreatureId = resolveSingleCreatureTargetId(state, step.target, ctx);
  if (!targetCreatureId) {
    return {
      kind: 'recorded_skip',
      message: `Skipped power/toughness switch (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const nextState = applyTemporarySwitchPowerToughness(state, targetCreatureId, ctx);
  if (!nextState) {
    return {
      kind: 'recorded_skip',
      message: `Skipped power/toughness switch (target not on battlefield): ${step.raw}`,
      reason: 'target_not_on_battlefield',
    };
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [`${targetCreatureId} switches power and toughness until end of turn`],
  };
}
