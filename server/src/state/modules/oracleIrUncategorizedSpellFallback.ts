import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { OracleIRExecutionContext, OracleIRExecutionOptions } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import {
  ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS,
  ORACLE_IR_FALLBACK_STEP_KINDS,
  TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS,
  collectOracleEffectSteps,
  wouldOracleIRFallbackPrefilterMatch,
} from './trigger-runtime-wiring.js';
import { buildOracleOverlayCollectOptions } from './oracleIrCompiledOverlayLookup.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerZoneSync.js';
import {
  describeMissingMandatoryOracleIrSteps,
  describeOracleIrExecutionHandledIncomplete,
  isOptionalOracleEffectStep,
  logOracleIrAllOrNothingFailure,
} from './oracleIrStepWiring.js';
import { isOracleIrExecutionHandled } from './oracleIrSpellExecution.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { applyInstantSorceryGraveyardConditionalTokenRider } from './stackResolveSpellPostCategorizeRidersUtils.js';
import { detectInstantSorcerySpellShapeFlags } from './oracleIrSpellLegacySpellShapeUtils.js';
import { applyInstantSorceryNibelheimAflameEffect } from './stackResolveSpellSpecialCaseUtils.js';
import { isCelestialReunionOracle } from './chosen-creature-type.js';

const UNLESS_PAY_KINDS = new Set<string>([
  'unless_pays_mana',
  'unless_pays_life',
]);

function isOptionalStep(step: OracleEffectStep): boolean {
  return isOptionalOracleEffectStep(step);
}

function mandatoryStepsFrom(allSteps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return allSteps.filter((step) => step && step.kind !== 'unknown' && !isOptionalStep(step));
}

function hasTapAntecedentScalerDependency(steps: readonly OracleEffectStep[]): boolean {
  const hasTapScaler = steps.some(
    (step) =>
      step.kind === 'modify_pt'
      && (step as { scaler?: { kind?: string } }).scaler?.kind === 'per_creature_tapped_this_way',
  );
  if (!hasTapScaler) return false;
  return steps.some(
    (step) => step.kind === 'tap_or_untap' || step.kind === 'tap_matching_permanents',
  );
}

function shouldIncludeUncategorizedSpellFallbackStep(step: OracleEffectStep): boolean {
  if (!step || step.kind === 'unknown') return false;
  if (ORACLE_IR_EFFECT_PROGRAM_STEP_KINDS.has(String(step.kind))) return false;

  if (isOptionalStep(step)) {
    if (UNLESS_PAY_KINDS.has(String(step.kind))) return true;
    if (TRIGGER_OPTIONAL_RUNTIME_STEP_KINDS.has(String(step.kind))) return true;
    if (ORACLE_IR_FALLBACK_STEP_KINDS.has(String(step.kind))) return true;
    return true;
  }

  if (step.kind === 'conditional') return true;
  if (UNLESS_PAY_KINDS.has(String(step.kind))) return true;
  return ORACLE_IR_FALLBACK_STEP_KINDS.has(String(step.kind));
}

function collectSpellSteps(oracleText: string, spellName: string, sourceItem?: any): OracleEffectStep[] {
  const overlayOptions = buildOracleOverlayCollectOptions({
    cardName: spellName,
    sourceName: spellName,
    sourceItem,
    card: sourceItem?.card,
    effectiveCard: sourceItem?.card,
  });
  const fromShared = collectOracleEffectSteps(oracleText, spellName, overlayOptions);
  if (fromShared.length > 0) return fromShared;

  const ir = parseOracleTextToIR(oracleText, spellName);
  const steps: OracleEffectStep[] = [];
  for (const ability of ir.abilities || []) {
    for (const step of ability.steps || []) {
      if (step) steps.push(step as OracleEffectStep);
    }
  }
  return steps;
}

/** Celestial X-search + shuffle stay on legacy tutor bridge until IR queue parity is complete. */
function isCelestialLegacyLibrarySearchStep(step: OracleEffectStep): boolean {
  return step.kind === 'search_library' || step.kind === 'shuffle_library';
}

function excludeCelestialLegacyOwnedSteps(
  steps: readonly OracleEffectStep[],
  oracleText: string,
): OracleEffectStep[] {
  if (!isCelestialReunionOracle(oracleText)) return [...steps];
  return steps.filter((step) => !isCelestialLegacyLibrarySearchStep(step));
}

/**
 * Best-effort Oracle IR resolution for spells that did not match categorizeSpell.
 * Delegates to applyOracleIRStepsOnServer instead of duplicating per-step handlers.
 */
export function applyOracleIRUncategorizedSpellFallback(
  ctx: GameContext,
  oracleText: string,
  caster: PlayerID,
  spellName: string,
  xValue?: number,
  sourcePermanentId?: string,
  sourceId?: string,
  castFromGraveyard?: boolean,
  irCtx?: OracleIRExecutionContext,
  sourceObjectType: 'spell' | 'ability' = 'spell',
  sourceItem?: any,
  targets?: readonly string[],
  executionOptions?: OracleIRExecutionOptions,
): number {
  try {
    const text = String(oracleText || '').trim();
    if (!text || !wouldOracleIRFallbackPrefilterMatch(text)) return 0;

    const textLower = text.toLowerCase();
    const allSteps = collectSpellSteps(text, spellName, sourceItem);
    let fallbackSteps = allSteps.filter(shouldIncludeUncategorizedSpellFallbackStep);
    const hasGraveyardTokenInsteadRider = Boolean(
      castFromGraveyard
      && /if this spell was cast from a graveyard,\s*create (?:a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) of those tokens instead/i.test(textLower),
    );
    if (hasGraveyardTokenInsteadRider) {
      fallbackSteps = fallbackSteps.filter((step) => {
        if (step.kind === 'create_token') return false;
        if (step.kind === 'conditional' && /of those tokens instead/i.test(String(step.raw || ''))) {
          return false;
        }
        return true;
      });
    }
    const isNibelheimShape = /choose target creature you control\. it deals damage equal to its power to each other creature/i.test(textLower);
    if (isNibelheimShape) {
      fallbackSteps = fallbackSteps.filter((step) => step.kind !== 'deal_damage');
    }
    fallbackSteps = excludeCelestialLegacyOwnedSteps(fallbackSteps, text);
    if (fallbackSteps.length === 0) return 0;

    const mandatoryAll = mandatoryStepsFrom(excludeCelestialLegacyOwnedSteps(allSteps, text));
    const mandatoryIncluded = mandatoryStepsFrom(fallbackSteps);
    if (mandatoryAll.length > 0 && mandatoryIncluded.length < mandatoryAll.length) {
      logOracleIrAllOrNothingFailure(
        'fallback',
        spellName,
        describeMissingMandatoryOracleIrSteps(allSteps, fallbackSteps),
        {
          applied: mandatoryIncluded.length,
          parsed: allSteps.length,
          mandatory: mandatoryAll.length,
        },
      );
      return 0;
    }

    const chosenCreatureType = String(
      sourceItem?.chosenCreatureType
      || sourceItem?.card?.chosenCreatureType
      || irCtx?.selectorContext?.chosenCreatureType
      || irCtx?.chosenCreatureType
      || '',
    ).trim();
    const targetPlayerId = String(
      sourceItem?.targetPlayerId
      || sourceItem?.defendingPlayer
      || irCtx?.selectorContext?.targetPlayerId
      || irCtx?.targetPlayerId
      || '',
    ).trim() as PlayerID | undefined;
    const lastAntecedentBattlefieldPermanentIds = (
      Array.isArray(sourceItem?.lastAntecedentBattlefieldPermanentIds)
        ? sourceItem.lastAntecedentBattlefieldPermanentIds
        : Array.isArray(sourceItem?.antecedentPermanentIds)
          ? sourceItem.antecedentPermanentIds
          : Array.isArray(irCtx?.lastAntecedentBattlefieldPermanentIds)
            ? irCtx.lastAntecedentBattlefieldPermanentIds
            : Array.isArray(irCtx?.selectorContext?.lastAntecedentBattlefieldPermanentIds)
              ? irCtx.selectorContext.lastAntecedentBattlefieldPermanentIds
              : []
    )
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean);

    const executionCtx = irCtx
      ? {
          ...irCtx,
          ...(chosenCreatureType || targetPlayerId || lastAntecedentBattlefieldPermanentIds.length > 0
            ? {
                ...(chosenCreatureType ? { chosenCreatureType } : {}),
                ...(targetPlayerId ? { targetPlayerId } : {}),
                ...(lastAntecedentBattlefieldPermanentIds.length > 0
                  ? { lastAntecedentBattlefieldPermanentIds }
                  : {}),
                selectorContext: {
                  ...(irCtx.selectorContext || {}),
                  ...(chosenCreatureType ? { chosenCreatureType } : {}),
                  ...(targetPlayerId ? { targetPlayerId } : {}),
                  ...(lastAntecedentBattlefieldPermanentIds.length > 0
                    ? { lastAntecedentBattlefieldPermanentIds }
                    : {}),
                },
              }
            : {}),
        }
      : buildOracleIRExecutionContext({
      controllerId: caster,
      sourceId: sourcePermanentId || sourceId,
      sourceName: spellName,
      sourceObjectType,
      xValue,
      ...(castFromGraveyard ? { castFromZone: 'graveyard' as const } : {}),
      ...(chosenCreatureType
        ? {
            selectorContext: { chosenCreatureType },
            chosenCreatureType,
          }
        : {}),
    }, {
      sourceObjectType,
      castFromZone: castFromGraveyard ? 'graveyard' : undefined,
      ...(chosenCreatureType ? { chosenCreatureType } : {}),
    });

    const gameId = String((ctx as any).gameId || 'unknown');
    const queueBefore = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : 0;

    const optionalSteps = fallbackSteps.filter(isOptionalStep);
    const mandatorySteps = fallbackSteps.filter((step) => !isOptionalStep(step));
    const preserveTapScalerOrder = hasTapAntecedentScalerDependency(fallbackSteps);

    let applied = 0;

    const countHandled = (result: ReturnType<typeof applyOracleIRStepsOnServer>, queueStart: number, parsedSteps: readonly OracleEffectStep[]) => {
      const queueAfter = gameId !== 'unknown'
        ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
        : queueStart;
      if (!isOracleIrExecutionHandled(result, queueStart, queueAfter, parsedSteps)) return;
      if (result.appliedSteps.length > 0) {
        applied += result.appliedSteps.length;
        return;
      }
      if (queueAfter > queueStart) {
        applied += 1;
      }
    };

    const serverParams = {
      controller: caster,
      ...(targetPlayerId ? { targetPlayerId } : {}),
      applyMillReplacements: true,
      ...(sourceItem ? { sourceItem } : {}),
    };

    const baseExecutionOptions: OracleIRExecutionOptions = {
      ...(executionOptions || {}),
    };
    const mandatoryExecutionOptions: OracleIRExecutionOptions = {
      ...baseExecutionOptions,
      allowOptional: false,
    };

    if (preserveTapScalerOrder) {
      const result = applyOracleIRStepsOnServer(
        ctx,
        (ctx as any).state,
        fallbackSteps,
        {
          ...executionCtx,
          controllerId: caster,
          sourceName: spellName,
          sourceId: sourcePermanentId || sourceId,
        },
        {
          ...baseExecutionOptions,
          allowOptional: true,
        },
        serverParams,
      );
      countHandled(result, queueBefore, fallbackSteps);
    } else {
      if (mandatorySteps.length > 0) {
        const result = applyOracleIRStepsOnServer(
          ctx,
          (ctx as any).state,
          mandatorySteps,
          {
            ...executionCtx,
            controllerId: caster,
            sourceName: spellName,
            sourceId: sourcePermanentId || sourceId,
          },
          mandatoryExecutionOptions,
          serverParams,
        );
        countHandled(result, queueBefore, mandatorySteps);
      }

      for (const step of optionalSteps) {
        const queueStart = gameId !== 'unknown'
          ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
          : 0;
        const result = applyOracleIRStepsOnServer(
          ctx,
          (ctx as any).state,
          [step],
          {
            ...executionCtx,
            controllerId: caster,
            sourceName: spellName,
            sourceId: sourcePermanentId || sourceId,
          },
          {
            ...baseExecutionOptions,
            allowOptional: true,
          },
          serverParams,
        );
        countHandled(result, queueStart, [step]);
      }
    }

    if (applied > 0) {
      debug(2, `[oracleIR] Fallback applied ${applied} step(s) for ${spellName}`);
    }

    if (sourceObjectType === 'spell' && sourceItem && castFromGraveyard && applied > 0) {
      applyInstantSorceryGraveyardConditionalTokenRider(ctx, {
        controller: caster,
        card: sourceItem?.card || { name: spellName },
        effectiveCard: { name: spellName },
        item: sourceItem,
        oracleText: text,
        oracleTextLower: textLower,
        targets: Array.isArray(targets) ? [...targets] : [],
        spellXValue: xValue,
        uncategorizedSpellFallbackApplied: applied,
      });
    }

    if (sourceObjectType === 'spell' && isNibelheimShape && Array.isArray(targets) && targets.length > 0 && sourceItem) {
      const shapeFlags = detectInstantSorcerySpellShapeFlags(spellName, textLower);
      applyInstantSorceryNibelheimAflameEffect(ctx, {
        controller: caster,
        effectiveCard: { name: spellName },
        item: sourceItem,
        targets: [...targets],
        isNibelheimAflameStyleSweep: true,
        hasNibelheimGraveyardRider: shapeFlags.hasNibelheimGraveyardRider,
      });
    }

    return applied;
  } catch (err) {
    debugWarn(2, `[oracleIR] Fallback failed for ${spellName}:`, err);
    return 0;
  }
}
