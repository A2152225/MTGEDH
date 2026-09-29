import type { BattlefieldPermanent, GameState, PlayerID } from '../../shared/src';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type { OracleEffectStep } from './oracleIR';
import { findObjectByIdInState } from './oracleIRExecutorModifyPtWhereUtils';
import { getAmountOfSpecificManaSymbolSpent } from './oracleIRExecutorManaUtils';
import {
  applyTemporaryPowerToughnessModifier,
  applyTemporarySetBasePowerToughness,
  applyTemporarySwitchPowerToughness,
  getProcessedBattlefield,
  readPermanentPower,
  readPermanentToughness,
  resolveCreatureTargetIds,
  resolveSingleCreatureTargetId,
  resolveTrepanationBoostTargetCreatureId,
} from './oracleIRExecutorCreatureStepUtils';
import {
  countArtifactsYouControl,
  countBasicLandTypesAmongLandsYouControl,
  countControlledCreaturesWithSubtype,
  countCreaturesBlockingTarget,
  countOtherAttackingAurochs,
} from './oracleIRExecutorModifyPtStepHandlers-handlers/oracleIRExecutorModifyPtScalerCountHelpers';
import { resolveReferenceScalerScale } from './oracleIRExecutorModifyPtStepHandlers-handlers/oracleIRExecutorModifyPtReferenceScaler';
import type { ModifyPtRuntime } from './oracleIRExecutorModifyPtStepHandlers-handlers/oracleIRExecutorModifyPtStepTypes';
export type { ModifyPtRuntime };


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
    | 'no_applicable_targets'
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
  let targetCreatureIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (
    targetCreatureIds.length === 0 &&
    (step.target as any)?.kind === 'equipped_creature' &&
    /^(the|that) creature gets/i.test(String(step.raw || ''))
  ) {
    targetCreatureIds = resolveCreatureTargetIds(state, { kind: 'raw', text: 'that creature' }, ctx);
  }

  if (/double target creature's power and toughness/i.test(String(step.raw || ''))) {
    if (targetCreatureIds.length === 0) {
      const boundId = String(
        ctx.targetCreatureId ||
          ctx.selectorContext?.targetCreatureId ||
          ctx.selectorContext?.chosenObjectIds?.[0] ||
          ''
      ).trim();
      if (boundId) targetCreatureIds = [boundId];
    }
    if (targetCreatureIds.length === 0) {
      return {
        kind: 'recorded_skip',
        message: `Skipped P/T modifier (no applicable targets): ${step.raw}`,
        reason: 'no_applicable_targets',
      };
    }
    let nextState: GameState | null = state;
    for (const targetCreatureId of targetCreatureIds) {
      const permanent = (state.battlefield || []).find(
        (entry: any) => String(entry?.id || '').trim() === targetCreatureId
      ) as any;
      const power = Number(permanent?.power ?? permanent?.card?.power ?? 0);
      const toughness = Number(permanent?.toughness ?? permanent?.card?.toughness ?? 0);
      nextState = applyTemporaryPowerToughnessModifier(
        nextState,
        targetCreatureId,
        ctx,
        Number.isFinite(power) ? power : 0,
        Number.isFinite(toughness) ? toughness : 0,
        false
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
      log: [`Doubled power/toughness for ${targetCreatureIds.length} creature(s)`],
    };
  }

  if (/creature type of your choice/i.test(String((step.target as any)?.text || step.raw || ''))) {
    const chosenType = String(
      ctx.selectorContext?.chosenCreatureType ||
        ctx.selectorContext?.chosenType ||
        'human'
    )
      .trim()
      .toLowerCase();
    const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(Number(ctx.xValue))) : 1;
    const matches = ((state.battlefield || []) as any[]).filter((perm: any) => {
      if (String(perm?.controller || perm?.controllerId || '').trim() !== String(controllerId || '').trim()) {
        return false;
      }
      const typeLine = String(perm?.type_line || perm?.card?.type_line || '').toLowerCase();
      return typeLine.includes('creature') && typeLine.includes(chosenType);
    });
    if (matches.length === 0) {
      return {
        kind: 'recorded_skip',
        message: `Skipped P/T modifier (no applicable targets): ${step.raw}`,
        reason: 'no_applicable_targets',
      };
    }
    let nextState: GameState | null = state;
    for (const permanent of matches) {
      const targetCreatureId = String((permanent as any)?.id || '').trim();
      if (!targetCreatureId) continue;
      nextState = applyTemporaryPowerToughnessModifier(nextState, targetCreatureId, ctx, xValue, xValue, false);
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
      log: [`${matches.length} creature(s) of chosen type get +${xValue}/+${xValue}`],
    };
  }

  const questWhereText = String(
    step.condition?.kind === 'where'
      ? step.condition.raw
      : step.raw || ''
  );
  if (/quest counters on this permanent/i.test(questWhereText)) {
    if (targetCreatureIds.length === 0) {
      const boundId = String(
        ctx.targetCreatureId ||
          ctx.selectorContext?.targetCreatureId ||
          (Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds[0] : '') ||
          ''
      ).trim();
      if (boundId) targetCreatureIds = [boundId];
    }
    const sourceId = String(ctx.sourceId || '').trim();
    const source = sourceId
      ? ((state.battlefield || []) as BattlefieldPermanent[]).find(
          (perm: any) => String(perm?.id || '').trim() === sourceId
        )
      : undefined;
    const questCount = Number(((source as any)?.counters || {}).quest ?? 0) || 0;
    if (targetCreatureIds.length === 0) {
      return { kind: 'applied', state, log: ['No quest-counter buff target on battlefield'] };
    }
    let nextState: GameState | null = state;
    for (const targetCreatureId of targetCreatureIds) {
      nextState = applyTemporaryPowerToughnessModifier(
        nextState,
        targetCreatureId,
        ctx,
        questCount,
        questCount,
        false
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
      log: [`${targetCreatureIds.length} creature(s) get +${questCount}/+${questCount} from quest counters`],
    };
  }

  if (targetCreatureIds.length === 0) {
    const sourceId = String(ctx.sourceId || '').trim();
    const targetText = String((step.target as any)?.text || step.raw || '').trim().toLowerCase();
    if (sourceId && (/^it\b/.test(targetText) || /\bit gets\b/i.test(String(step.raw || '')))) {
      targetCreatureIds = [sourceId];
    }
  }

  if (targetCreatureIds.length === 0) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  if (/\{e\} paid this way/i.test(String(step.raw || ''))) {
    // The {E} is paid as part of casting the source, so when the caller did not pre-compute the
    // amount it can still be read off the source spell's recorded payment.
    const energyFromSource = (() => {
      const sourceId = String(ctx.sourceId || '').trim();
      if (!sourceId) return null;
      const sourceObject = findObjectByIdInState(state, ((state as any).battlefield || []) as any[], sourceId);
      if (!sourceObject) return null;
      const paid = getAmountOfSpecificManaSymbolSpent(sourceObject, 'E');
      return Number.isFinite(paid as number) && (paid as number) > 0 ? (paid as number) : null;
    })();
    const energyPaid = Math.max(
      1,
      Number((ctx as any)?.energyPaidThisWay ?? ctx.referenceAmount ?? ctx.xValue ?? energyFromSource ?? 1)
    );
    const powerBonus = (Number(step.power) || 0) * energyPaid;
    const toughnessBonus = (Number(step.toughness) || 0) * energyPaid;
    let nextState: GameState | null = state;
    for (const targetCreatureId of targetCreatureIds) {
      nextState = applyTemporaryPowerToughnessModifier(
        nextState,
        targetCreatureId,
        ctx,
        powerBonus,
        toughnessBonus,
        false
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
      log: [
        `${targetCreatureIds.length} creature(s) get ${powerBonus}/${toughnessBonus} until end of turn (${energyPaid} energy paid)`,
      ],
    };
  }

  const doublePowerUntilEot = /^double\s+/i.test(String(step.raw || ''))
    && /\bpower until end of turn/i.test(String(step.raw || ''))
    && !/\bpower and toughness\b/i.test(String(step.raw || ''));
  const doublePowerToughnessUntilEot = /^double\s+/i.test(String(step.raw || ''))
    && /\bpower and toughness until end of turn/i.test(String(step.raw || ''));
  if (doublePowerUntilEot || doublePowerToughnessUntilEot) {
    let nextState: GameState | null = state;
    const battlefield = getProcessedBattlefield(state);
    const appliedLogs: string[] = [];
    for (const targetCreatureId of targetCreatureIds) {
      const permanent = battlefield.find((entry) => String((entry as any)?.id || '').trim() === targetCreatureId);
      const currentPower = Math.max(0, readPermanentPower(permanent) ?? 0);
      const currentToughness = doublePowerToughnessUntilEot
        ? Math.max(0, readPermanentToughness(permanent) ?? 0)
        : 0;
      nextState = applyTemporaryPowerToughnessModifier(
        nextState,
        targetCreatureId,
        ctx,
        currentPower,
        currentToughness,
        false,
      );
      if (!nextState) {
        return {
          kind: 'recorded_skip',
          message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
          reason: 'target_not_on_battlefield',
        };
      }
      appliedLogs.push(
        doublePowerToughnessUntilEot
          ? `${targetCreatureId} gets +${currentPower}/+${currentToughness} until end of turn`
          : `${targetCreatureId} gets +${currentPower}/+0 until end of turn`,
      );
    }
    return {
      kind: 'applied',
      state: nextState,
      log: appliedLogs,
    };
  }

  let whereXValue: number | null = null;
  const conditionRaw = step.condition?.kind === 'where' ? String(step.condition.raw || '') : '';
  const perTargetWhereX =
    step.condition?.kind === 'where' &&
    (/\bon it\b/i.test(conditionRaw) ||
      /\bits (?:power|toughness)\b/i.test(conditionRaw));
  const usesWhereForX = step.condition?.kind === 'where';

  if (step.condition) {
    if (step.condition.kind === 'where') {
      if (!perTargetWhereX) {
        whereXValue = evaluateWhereX(
          state,
          controllerId,
          step.condition.raw,
          targetCreatureIds[0],
          ctx,
          runtime
        );
        if (whereXValue === null) {
          const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number)) : null;
          if (xValue !== null) whereXValue = xValue;
        }
        if (whereXValue === null) {
          return {
            kind: 'recorded_skip',
            message: `Skipped P/T modifier (unsupported where-clause): ${step.raw}`,
            reason: 'unsupported_where_clause',
          };
        }
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
    const inferredScalerRaw = String(step.raw || '').match(/\bfor each (.+?)(?:\.|$)/i)?.[1]?.trim();
    if (inferredScalerRaw) {
      const inferredScale = resolveReferenceScalerScale(
        state,
        controllerId,
        targetCreatureIds[0],
        `for each ${inferredScalerRaw}`,
        runtime,
        ctx,
        step,
      );
      if (inferredScale !== null) {
        const basePower = step.powerUsesX
          ? (usesWhereForX ? ((step.power | 0) * (whereXValue ?? 0)) : (step.power | 0))
          : (step.power | 0);
        const baseToughness = step.toughnessUsesX
          ? (usesWhereForX ? ((step.toughness | 0) * (whereXValue ?? 0)) : (step.toughness | 0))
          : (step.toughness | 0);
        const powerBonus = basePower * inferredScale;
        const toughnessBonus = baseToughness * inferredScale;
        let nextState: GameState | null = state;
        for (const targetCreatureId of targetCreatureIds) {
          nextState = applyTemporaryPowerToughnessModifier(
            nextState,
            targetCreatureId,
            ctx,
            powerBonus,
            toughnessBonus,
            false
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
    }
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
      reason: 'unsupported_scaler',
    };
  }

  let scale = 1;
  if (step.scaler?.kind === 'reference_scaler') {
    const resolvedScale = resolveReferenceScalerScale(
      state,
      controllerId,
      targetCreatureIds[0],
      String(step.scaler.raw || ''),
      runtime,
      ctx,
      step,
    );
    if (resolvedScale === null) {
      return {
        kind: 'recorded_skip',
        message: `Skipped P/T modifier (unsupported scaler): ${step.raw}`,
        reason: 'unsupported_scaler',
      };
    }
    scale = resolvedScale;
  } else if (step.scaler) {
    const scalerKind = String(step.scaler.kind);
    scale =
      scalerKind === 'per_revealed_this_way'
        ? Math.max(0, runtime.lastRevealedCardCount | 0)
        : scalerKind === 'per_creature_blocking_it'
          ? Math.max(0, countCreaturesBlockingTarget(state, targetCreatureIds[0]))
          : scalerKind === 'per_basic_land_type_among_lands_you_control'
            ? Math.max(0, countBasicLandTypesAmongLandsYouControl(state, controllerId))
            : scalerKind === 'per_artifact_you_control'
              ? Math.max(0, countArtifactsYouControl(state, controllerId))
              : scalerKind === 'per_creature_tapped_this_way'
                ? Math.max(0, runtime.lastTappedMatchingPermanentCount | 0)
                : scalerKind === 'per_goblin_you_control'
                  ? Math.max(0, countControlledCreaturesWithSubtype(state, controllerId, 'goblin'))
                  : scalerKind === 'per_other_attacking_aurochs'
                    ? Math.max(0, countOtherAttackingAurochs(state, targetCreatureIds[0]))
                    : 1;
  }

  if ((step.powerUsesX || step.toughnessUsesX) && usesWhereForX && whereXValue === null) {
    const inferredWhereRaw = String(step.raw || '').match(/\bwhere x is (.+?)(?:[.,]|$)/i)?.[1]?.trim();
    if (inferredWhereRaw) {
      whereXValue = evaluateWhereX(
        state,
        controllerId,
        inferredWhereRaw,
        targetCreatureIds[0],
        ctx,
        runtime
      );
    }
  }

  if ((step.powerUsesX || step.toughnessUsesX) && usesWhereForX && whereXValue === null) {
    const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number)) : null;
    if (xValue !== null) whereXValue = xValue;
  }

  if ((step.powerUsesX || step.toughnessUsesX) && usesWhereForX && whereXValue === null && !perTargetWhereX) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (X used without supported where-clause): ${step.raw}`,
      reason: 'unsupported_where_clause',
    };
  }

  const perTargetScaler =
    step.scaler?.kind === 'reference_scaler' &&
    (
      /^for each poison counter its controller has$/i.test(String(step.scaler.raw || '').trim()) ||
      /\bon it\b/i.test(String(step.scaler.raw || ''))
    );

  let nextState: GameState | null = state;
  const logLines: string[] = [];
  let appliedCount = 0;
  for (const targetCreatureId of targetCreatureIds) {
    let targetWhereX = whereXValue;
    if (perTargetWhereX && step.condition?.kind === 'where') {
      targetWhereX = evaluateWhereX(
        state,
        controllerId,
        step.condition.raw,
        targetCreatureId,
        ctx,
        runtime
      );
      if (targetWhereX === null) continue;
    }

    const basePower = step.powerUsesX
      ? (usesWhereForX ? ((step.power | 0) * (targetWhereX ?? 0)) : (step.power | 0))
      : (step.power | 0);
    const baseToughness = step.toughnessUsesX
      ? (usesWhereForX ? ((step.toughness | 0) * (targetWhereX ?? 0)) : (step.toughness | 0))
      : (step.toughness | 0);
    const effectiveScale = perTargetScaler
      ? (resolveReferenceScalerScale(
          state,
          controllerId,
          targetCreatureId,
          String(step.scaler?.raw || ''),
          runtime,
          ctx,
          step,
        ) ?? 0)
      : scale;
    const powerBonus = basePower * effectiveScale;
    const toughnessBonus = baseToughness * effectiveScale;
    if (powerBonus === 0 && toughnessBonus === 0) {
      // Per-target scaling ("for each counter on it") leaves a permanent with zero instances
      // untouched. A global X that resolved to zero still creates a +0/+0 continuous effect on its
      // target, so fall through and record the modifier for that case only.
      const resolvedGlobalZero = !perTargetWhereX && !perTargetScaler && usesWhereForX && targetWhereX !== null;
      if (!resolvedGlobalZero) {
        if (usesWhereForX && targetWhereX !== null) {
          appliedCount += 1;
        } else if (!usesWhereForX && (step.scaler || perTargetScaler)) {
          appliedCount += 1;
        }
        continue;
      }
    }

    nextState = applyTemporaryPowerToughnessModifier(
      nextState,
      targetCreatureId,
      ctx,
      powerBonus,
      toughnessBonus,
      step.scaler?.kind === 'per_revealed_this_way',
      step.duration === 'until_next_turn'
        ? 'until_next_turn'
        : step.duration === 'end_of_combat'
          ? 'end_of_combat'
          : 'end_of_turn',
    );

    if (!nextState) {
      return {
        kind: 'recorded_skip',
        message: `Skipped P/T modifier (target not on battlefield): ${step.raw}`,
        reason: 'target_not_on_battlefield',
      };
    }
    appliedCount += 1;
    logLines.push(`1 creature gets ${powerBonus >= 0 ? '+' : ''}${powerBonus}/${toughnessBonus >= 0 ? '+' : ''}${toughnessBonus}`);
  }

  if (appliedCount === 0) {
    return {
      kind: 'recorded_skip',
      message: `Skipped P/T modifier (no applicable targets): ${step.raw}`,
      reason: 'no_applicable_targets',
    };
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [
      `${appliedCount} creature(s) get modified until end of turn`,
      ...logLines,
    ],
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
  if (/^it has base power and toughness 1\/1 until end of turn$/i.test(String(step.raw || '').trim())) {
    const candidateIds = [
      String(ctx.targetPermanentId || ''),
      String(ctx.targetCreatureId || ''),
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
      String(ctx.sourceId || ''),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const seen = new Set<string>();
    for (const candidateId of candidateIds) {
      if (seen.has(candidateId)) continue;
      seen.add(candidateId);
      const nextState = applyTemporarySetBasePowerToughness(state, candidateId, ctx, 1, 1);
      if (nextState) {
        return {
          kind: 'applied',
          state: nextState,
          log: [`${candidateId} has base power and toughness 1/1 until end of turn`],
        };
      }
    }
  }

  const targetCreatureIds = resolveCreatureTargetIds(state, step.target, ctx);
  if (targetCreatureIds.length === 0) {
    return {
      kind: 'recorded_skip',
      message: `Skipped base P/T setter (no deterministic creature target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const xValue = Number.isFinite(ctx.xValue) ? Math.max(0, Math.floor(ctx.xValue as number)) : null;
  if ((((step as any).powerUsesX) || ((step as any).toughnessUsesX)) && xValue === null) {
    return {
      kind: 'recorded_skip',
      message: `Skipped base P/T setter (missing X value): ${step.raw}`,
      reason: 'unsupported_scaler',
    };
  }

  const power = (step as any).powerUsesX ? ((step.power | 0) * (xValue ?? 0)) : (step.power | 0);
  const toughness = (step as any).toughnessUsesX ? ((step.toughness | 0) * (xValue ?? 0)) : (step.toughness | 0);

  let nextState = state;
  for (const targetCreatureId of targetCreatureIds) {
    const updatedState = applyTemporarySetBasePowerToughness(
      nextState,
      targetCreatureId,
      ctx,
      power,
      toughness
    );
    if (!updatedState) {
      return {
        kind: 'recorded_skip',
        message: `Skipped base P/T setter (target not on battlefield): ${step.raw}`,
        reason: 'target_not_on_battlefield',
      };
    }
    nextState = updatedState;
  }

  return {
    kind: 'applied',
    state: nextState,
    log: [
      targetCreatureIds.length === 1
        ? `${targetCreatureIds[0]} has base power and toughness ${power}/${toughness} until end of turn`
        : `${targetCreatureIds.length} creatures have base power and toughness ${power}/${toughness} until end of turn`,
    ],
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
