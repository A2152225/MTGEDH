import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import type { OracleIRExecutionContext, OracleIRExecutionOptions } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import {
  collectOracleEffectSteps,
  collectSpellResolutionEffectSteps,
  isUncategorizedFallbackExecutableStep,
  wouldOracleIRFallbackPrefilterMatch,
} from './trigger-runtime-wiring.js';
import { buildOracleOverlayCollectOptions } from './oracleIrCompiledOverlayLookup.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerZoneSync.js';
import { startOracleEffectProgramOnServer } from './oracleIrEffectProgramServer.js';
import {
  describeMissingMandatoryOracleIrSteps,
  isOptionalOracleEffectStep,
  logOracleIrAllOrNothingFailure,
} from './oracleIrStepWiring.js';
import { isOracleIrExecutionHandled } from './oracleIrSpellExecution.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { applyInstantSorceryGraveyardConditionalTokenRider } from './stackResolveSpellPostCategorizeRidersUtils.js';

function isOptionalStep(step: OracleEffectStep): boolean {
  return isOptionalOracleEffectStep(step);
}

function mandatoryStepsFrom(allSteps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return allSteps.filter((step) => step && step.kind !== 'unknown' && !isOptionalStep(step));
}

function shouldIncludeUncategorizedSpellFallbackStep(step: OracleEffectStep): boolean {
  return isUncategorizedFallbackExecutableStep(step);
}

function normalizeSelectedModeIdsFromSource(sourceItem: any): string[] | undefined {
  const raw = sourceItem?.selectedModeIds ?? sourceItem?.chosenModes ?? sourceItem?.modeIds;
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  return raw.map((id: unknown) => String(id || '').trim()).filter(Boolean);
}

const PREFIXED_CHOICE_STEP_KINDS = [
  'choose_creature_type',
  'choose_color',
  'choose_card_name',
  'choose_opponent',
] as const;

/**
 * Fallback EP gate: modal / fateseal / clash / prefixed choose-* only.
 * Optional "you may" steps stay on Pattern A (`allowOptional`) so pre-bound
 * targets (e.g. tap-any-number → per-tapped pump) keep applying without a
 * may-choice pause that the primary path owns separately.
 */
function requiresUncategorizedFallbackEffectProgram(
  steps: readonly OracleEffectStep[],
  selectedModeIds?: readonly string[],
): boolean {
  if (!Array.isArray(steps) || steps.length === 0) return false;

  const hasUnresolvedChooseMode = steps.some((step) => step.kind === 'choose_mode')
    && (!Array.isArray(selectedModeIds) || selectedModeIds.length === 0);
  if (hasUnresolvedChooseMode) return true;

  if (steps.some((step) => step.kind === 'fateseal' || step.kind === 'clash')) {
    return true;
  }

  for (const prefixKind of PREFIXED_CHOICE_STEP_KINDS) {
    const prefixIndex = steps.findIndex((step) => step.kind === prefixKind);
    if (
      prefixIndex >= 0
      && steps.slice(prefixIndex + 1).some((step) => step.kind !== 'unknown')
    ) {
      return true;
    }
  }
  return false;
}

function collectSpellSteps(
  oracleText: string,
  spellName: string,
  sourceItem?: any,
  sourceObjectType: 'spell' | 'ability' = 'spell',
): OracleEffectStep[] {
  const overlayOptions = buildOracleOverlayCollectOptions({
    cardName: spellName,
    sourceName: spellName,
    sourceItem,
    card: sourceItem?.card,
    effectiveCard: sourceItem?.card,
  });
  if (sourceObjectType === 'ability') {
    return collectOracleEffectSteps(oracleText, spellName, overlayOptions);
  }
  const fromShared = collectSpellResolutionEffectSteps(oracleText, spellName, overlayOptions);
  if (fromShared.length > 0) return fromShared;

  const ir = parseOracleTextToIR(oracleText, spellName);
  const steps: OracleEffectStep[] = [];
  for (const ability of ir.abilities || []) {
    if (String(ability?.type || '').toLowerCase() !== 'spell') continue;
    for (const step of ability.steps || []) {
      if (step) steps.push(step as OracleEffectStep);
    }
  }
  return steps;
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

    const allSteps = collectSpellSteps(text, spellName, sourceItem, sourceObjectType);
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
    if (fallbackSteps.length === 0) return 0;

    const sourcePermanent = sourcePermanentId
      ? ((ctx as any).state?.battlefield || []).find(
        (permanent: any) => String(permanent?.id || '').trim() === sourcePermanentId,
      )
      : undefined;
    const preselectedChosenCreatureType = String(
      sourceItem?.chosenCreatureType
      || sourceItem?.card?.chosenCreatureType
      || sourcePermanent?.chosenCreatureType
      || irCtx?.selectorContext?.chosenCreatureType
      || irCtx?.chosenCreatureType
      || '',
    ).trim();
    const allStepsForMandatory = preselectedChosenCreatureType
      ? allSteps.filter((step) => step.kind !== 'choose_creature_type')
      : allSteps;
    const mandatorySourceSteps = allStepsForMandatory;

    const mandatoryAll = mandatoryStepsFrom(mandatorySourceSteps);
    const mandatoryIncluded = mandatoryStepsFrom(fallbackSteps);
    if (mandatoryAll.length > 0 && mandatoryIncluded.length < mandatoryAll.length) {
      logOracleIrAllOrNothingFailure(
        'fallback',
        spellName,
        describeMissingMandatoryOracleIrSteps(allStepsForMandatory, fallbackSteps),
        {
          applied: mandatoryIncluded.length,
          parsed: allSteps.length,
          mandatory: mandatoryAll.length,
        },
        { gameId: String((ctx as any)?.gameId || '') || undefined, effectText: text },
      );
      return 0;
    }

    const chosenCreatureType = preselectedChosenCreatureType;
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

    let applied = 0;

    const countHandled = (result: ReturnType<typeof applyOracleIRStepsOnServer>, queueStart: number, parsedSteps: readonly OracleEffectStep[]) => {
      const queueAfter = gameId !== 'unknown'
        ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
        : queueStart;
      if (!isOracleIrExecutionHandled(result, queueStart, queueAfter, parsedSteps, (ctx as any).state, gameId)) return;
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
      oracleText: text,
    };

    const selectedModeIds = normalizeSelectedModeIdsFromSource(sourceItem);
    const mergedExecutionOptions: OracleIRExecutionOptions = {
      ...(executionOptions || {}),
      allowOptional: true,
      ...(selectedModeIds ? { selectedModeIds } : {}),
    };
    const resolvedExecutionCtx = {
      ...executionCtx,
      controllerId: caster,
      sourceName: spellName,
      sourceId: sourcePermanentId || sourceId,
    };

    // Pattern B: modal / fateseal / clash / prefixed choose-* (optional stays on Pattern A).
    if (requiresUncategorizedFallbackEffectProgram(fallbackSteps, selectedModeIds)) {
      const effectProgramResult = startOracleEffectProgramOnServer(ctx, {
        controller: caster,
        sourceName: spellName,
        sourceId: sourcePermanentId || sourceId,
        steps: fallbackSteps,
        irCtx: resolvedExecutionCtx,
        executionOptions: mergedExecutionOptions,
        programIdPrefix: `fallback:${sourceId || sourcePermanentId || spellName}`,
        metadata: {
          family: sourceObjectType === 'ability' ? 'trigger_resolution' : 'spell_resolution',
          ...(sourceItem ? { triggerItem: sourceItem } : {}),
        },
      });
      if (effectProgramResult.handled) {
        if (effectProgramResult.waitingForChoice && !effectProgramResult.completed) {
          applied = 1;
        } else if (effectProgramResult.completed) {
          applied = Math.max(1, fallbackSteps.length);
        }
      }
    }

    // Pattern A: single-pass apply (preserves tap→scaler order; optional steps via allowOptional).
    if (applied === 0) {
      const result = applyOracleIRStepsOnServer(
        ctx,
        (ctx as any).state,
        fallbackSteps,
        resolvedExecutionCtx,
        mergedExecutionOptions,
        serverParams,
      );
      countHandled(result, queueBefore, fallbackSteps);
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

    return applied;
  } catch (err) {
    debugWarn(2, `[oracleIR] Fallback failed for ${spellName}:`, err);
    return 0;
  }
}
