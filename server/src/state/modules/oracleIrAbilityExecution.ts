import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../../../rules-engine/src/oracleIRExecutor.js';
import {
  inferOracleIrTargetBinding,
  oracleIrTargetBindingToBaseContext,
  oracleIrTargetBindingToEventHint,
} from '../../../../rules-engine/src/oracleIrTargetBinding.js';
import { parseOracleTextToIR } from '../../../../rules-engine/src/oracleIRParser.js';
import { collectOracleEffectStepsWithOverlay } from '../../../../rules-engine/src/oracleIRCompilerEnvelope.js';
import { isRecognizedActivatedAbilityCostText } from '../../../../rules-engine/src/stationPermanentUtils.js';
import { parseStationKeywordActivatedAbility } from '../../../../rules-engine/src/oracleTextParserKeywordCosts.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerZoneSync.js';
import {
  requiresSpellEffectProgramOrchestration,
  startOracleEffectProgramOnServer,
} from './oracleIrEffectProgramServer.js';
import { normalizeOracleIrSelectedModeIds } from './oracleIrModeSelection.js';
import { resolvePermanentChosenColorSymbol } from './mana-abilities.js';
import { debug, debugWarn } from '../../utils/debug.js';
import {
  resolveCompiledOverlayForCard,
  extractOracleCardLookupKeys,
  type CollectOracleEffectStepsOptions,
} from './oracleIrCompiledOverlayLookup.js';
import {
  describeOracleIrActivatedAbilityIncomplete,
  getUnwiredOracleEffectStepKinds,
  isActivatedAbilityEffectFullyWired,
  isOracleIrActivatedAbilityHandled,
  logOracleIrAllOrNothingFailure,
} from './oracleIrStepWiring.js';

export {
  ORACLE_IR_ACTIVATED_ONLY_STEP_KINDS,
  ORACLE_IR_ACTIVATED_STEP_KINDS,
  areAllOracleEffectStepsRuntimeWired,
  describeOracleIrActivatedAbilityIncomplete,
  describeOracleIrMandatoryExecutionIncomplete,
  describeMissingMandatoryOracleIrSteps,
  getUnwiredOracleEffectStepKinds,
  isActivatedAbilityEffectFullyWired,
  isOracleEffectStepRuntimeWired,
  isOracleIrActivatedAbilityHandled,
  isOracleIrMandatoryExecutionComplete,
  logOracleIrAllOrNothingFailure,
} from './oracleIrStepWiring.js';

function stripInlineWaterbendReminder(text: string): string {
  return String(text || '')
    .replace(
      /\s*\(\s*while paying a waterbend cost, you can tap your artifacts and creatures to help\.\s*each one pays for \{1\}\.\s*\)\s*$/i,
      '',
    )
    .trim();
}

function extractActivatedEffectText(oracleText: string): string {
  const raw = String(oracleText || '').trim();
  if (!raw) return '';
  const powerUpSplit = raw.match(/^Power-up\s*[—-]\s*[^:]+:\s*(.+)$/is);
  if (powerUpSplit) return String(powerUpSplit[1] || '').trim();
  const colonSplit = raw.match(/^[^:]+:\s*(.+)$/s);
  return colonSplit ? String(colonSplit[1] || '').trim() : raw;
}

function applyCompiledOverlayToActivatedSteps(
  parsedText: string,
  sourceName: string,
  steps: readonly OracleEffectStep[],
  options?: CollectOracleEffectStepsOptions,
): OracleEffectStep[] {
  const overlay = resolveCompiledOverlayForCard({
    cardName: sourceName,
    ...options,
  });
  if (!overlay) return [...steps];
  const hasUnknown = steps.some((step) => step.kind === 'unknown');
  if (!hasUnknown && steps.length > 0) return [...steps];
  return [...collectOracleEffectStepsWithOverlay(parsedText, sourceName, overlay, options?.overlayOptions)];
}

export function collectActivatedAbilitySteps(
  oracleText: string,
  sourceName: string,
  options?: CollectOracleEffectStepsOptions,
): OracleEffectStep[] {
  const raw = stripInlineWaterbendReminder(String(oracleText || '').trim());
  if (!raw) return [];

  const thresholdLine = raw.match(/^(\d+)\+\s*\|\s*(.+)$/is);
  if (thresholdLine) {
    const innerText = String(thresholdLine[2] || '').trim();
    const innerColon = innerText.match(/^([^:]+):\s*(.+)$/s);
    if (innerColon && isRecognizedActivatedAbilityCostText(innerColon[1])) {
      const ir = parseOracleTextToIR(raw, sourceName);
      const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
      return applyCompiledOverlayToActivatedSteps(raw, sourceName, steps, options);
    }

    const ir = parseOracleTextToIR(innerText, sourceName);
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    return applyCompiledOverlayToActivatedSteps(innerText, sourceName, steps, options);
  }

  const costEffectSplit = raw.match(/^([^:]+):\s*(.+)$/s);
  if (costEffectSplit && isRecognizedActivatedAbilityCostText(String(costEffectSplit[1] || '').trim())) {
    const ir = parseOracleTextToIR(raw, sourceName);
    const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
    return applyCompiledOverlayToActivatedSteps(raw, sourceName, steps, options);
  }

  const effectText = extractActivatedEffectText(raw);
  if (!effectText) return [];
  const ir = parseOracleTextToIR(effectText, sourceName);
  const steps = (ir.abilities || []).flatMap((ability) => ability.steps || []);
  return applyCompiledOverlayToActivatedSteps(effectText, sourceName, steps, options);
}

function extractStationKeywordLineFromOracle(oracleText: string): string {
  return String(oracleText || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => /^Station\s*\(/i.test(line)) || '';
}

export {
  isStationPermanentTypeLine,
  readStationChargeCreatureThresholdFromOracleText,
} from '../../../../rules-engine/src/stationPermanentUtils.js';

export function inferStationChargeCounterEffectText(typeLine: string): string {
  const normalized = String(typeLine || '').toLowerCase();
  if (normalized.includes('planet')) {
    return 'Put charge counters equal to its power on this Planet.';
  }
  if (normalized.includes('spacecraft')) {
    return 'Put charge counters equal to its power on this Spacecraft.';
  }
  return 'Put charge counters equal to its power on this permanent.';
}

export function resolveStationChargeCounterEffectText(params: {
  effectText?: string;
  typeLine?: string;
  stationAbilityOracleText?: string;
}): string {
  const explicit = String(params.effectText || '').trim();
  if (explicit) return explicit;

  const stationLine = extractStationKeywordLineFromOracle(params.stationAbilityOracleText || '');
  if (stationLine) {
    const parsed = parseStationKeywordActivatedAbility(stationLine);
    if (parsed?.effect) return parsed.effect;
  }

  return inferStationChargeCounterEffectText(params.typeLine || '');
}

export function tryApplyStationChargeCountersViaOracleIR(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourcePermanentId: string;
    sourceName: string;
    stationedCreaturePower: number;
    effectText?: string;
    typeLine?: string;
    stationAbilityOracleText?: string;
  },
): { handled: boolean; countersAdded: number } {
  const power = Math.max(0, Math.floor(Number(params.stationedCreaturePower || 0)));
  if (power <= 0) {
    return { handled: true, countersAdded: 0 };
  }

  try {
    const effectOracle = resolveStationChargeCounterEffectText(params);
    const steps = collectActivatedAbilitySteps(effectOracle, params.sourceName);
    if (
      steps.length === 0
      || steps.some((step) => step.kind === 'unknown')
      || !steps.every((step) => step.kind === 'add_counter')
    ) {
      return { handled: false, countersAdded: 0 };
    }

    if (!isActivatedAbilityEffectFullyWired(steps)) {
      return { handled: false, countersAdded: 0 };
    }

    const state = (ctx as any).state;
    const stationBefore = (Array.isArray(state?.battlefield) ? state.battlefield : [])
      .find((permanent: any) => String(permanent?.id || '') === params.sourcePermanentId);
    const chargeBefore = Number(stationBefore?.counters?.charge || 0);

    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: params.controller,
        sourceId: params.sourcePermanentId,
        sourceName: params.sourceName,
        sourceObjectType: 'ability',
        referenceAmount: power,
        stationedCreaturePower: power,
      } as any,
      { sourceObjectType: 'ability' },
    );

    const gameId = String((ctx as any).gameId || 'unknown');
    const queueBefore = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : 0;

    const result = applyOracleIRStepsOnServer(ctx, state, steps, irCtx, {
      allowOptional: true,
    }, {
      controller: params.controller,
      applyMillReplacements: true,
    });

    const queueAfter = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : queueBefore;

    const handled = isOracleIrActivatedAbilityHandled(steps, result, {
      resolutionQueueStepsBefore: queueBefore,
      resolutionQueueStepsAfter: queueAfter,
    });

    const stationAfter = (Array.isArray(state?.battlefield) ? state.battlefield : [])
      .find((permanent: any) => String(permanent?.id || '') === params.sourcePermanentId);
    const chargeAfter = Number(stationAfter?.counters?.charge || 0);
    const countersAdded = Math.max(0, chargeAfter - chargeBefore);

    if (!handled) {
      logOracleIrAllOrNothingFailure(
        'activated',
        params.sourceName,
        describeOracleIrActivatedAbilityIncomplete(steps, result, {
          resolutionQueueStepsBefore: queueBefore,
          resolutionQueueStepsAfter: queueAfter,
        }),
        { applied: result.appliedSteps.length, parsed: steps.length },
        { gameId: gameId !== 'unknown' ? gameId : undefined },
      );
      return { handled: false, countersAdded: 0 };
    }

    debug(
      2,
      `[oracleIR] Station charge counters via IR for ${params.sourceName}: +${countersAdded} (power ${power})`,
    );
    return { handled: true, countersAdded };
  } catch (err) {
    debugWarn(1, `[oracleIR] Station charge counter execution failed for ${params.sourceName}:`, err);
    return { handled: false, countersAdded: 0 };
  }
}

export function readStationChargeThresholdFromActivatedOracleText(
  oracleText: string,
  sourceName: string,
): number | undefined {
  const raw = String(oracleText || '').trim();
  if (!raw || !/^\d+\+\s*\|/.test(raw)) return undefined;
  const ir = parseOracleTextToIR(raw, sourceName);
  const threshold = ir.abilities.find((ability) => ability.stationChargeThreshold != null)?.stationChargeThreshold;
  return threshold != null ? Number(threshold) : undefined;
}


export function tryApplyOracleIRToActivatedAbility(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceName: string;
    oracleText: string;
    sourcePermanentId?: string;
    stackItemId?: string;
    targets?: readonly string[];
    cardId?: string;
    sourceItem?: any;
    card?: any;
    teamworkWasPaid?: boolean;
    giftPromised?: boolean;
    selectedModeIds?: readonly string[];
    allowOptional?: boolean;
  },
): { handled: boolean; applied: number; pendingOptional: boolean } {
  try {
    const steps = collectActivatedAbilitySteps(params.oracleText, params.sourceName, {
      ...extractOracleCardLookupKeys({
        cardId: params.cardId,
        cardName: params.sourceName,
        sourceName: params.sourceName,
        sourceItem: params.sourceItem,
        card: params.card,
        effectiveCard: params.card,
      }),
    });
    if (steps.length === 0) {
      return { handled: false, applied: 0, pendingOptional: false };
    }

    if (steps.some((step) => step.kind === 'unknown')) {
      debug(
        2,
        `[oracleIR] Activated ability not fully wired for ${params.sourceName}: contains unknown step(s)`,
      );
      return { handled: false, applied: 0, pendingOptional: false };
    }

    if (!isActivatedAbilityEffectFullyWired(steps)) {
      const unwired = getUnwiredOracleEffectStepKinds(steps);
      debug(
        2,
        `[oracleIR] Activated ability not fully wired for ${params.sourceName}: ${unwired.join(', ')}`,
      );
      return { handled: false, applied: 0, pendingOptional: false };
    }

    const state = (ctx as any).state;
    const targetBinding = inferOracleIrTargetBinding(state, params.targets || [], params.controller);
    const sourcePermanentId = String(params.sourcePermanentId || params.stackItemId || '').trim();
    const sourcePermanent = (state?.battlefield || []).find(
      (perm: any) => perm && String(perm.id || '') === sourcePermanentId,
    );
    const chosenCreatureType = String(
      sourcePermanent?.chosenCreatureType
      || params.sourceItem?.chosenCreatureType
      || params.card?.chosenCreatureType
      || '',
    ).trim();
    const chosenColorName = String(
      sourcePermanent?.chosenColor
      || params.sourceItem?.chosenColor
      || params.card?.chosenColor
      || '',
    ).trim().toLowerCase();
    const chosenManaSymbol = resolvePermanentChosenColorSymbol(sourcePermanent || params.card) || undefined;
    const irCtx = buildOracleIRExecutionContext(
      {
        controllerId: params.controller,
        sourceId: params.sourcePermanentId || params.stackItemId,
        sourceName: params.sourceName,
        sourceObjectType: 'ability',
        ...(typeof params.teamworkWasPaid === 'boolean' ? { teamworkWasPaid: params.teamworkWasPaid } : {}),
        ...(typeof params.giftPromised === 'boolean' ? { giftPromised: params.giftPromised } : {}),
        ...(Array.isArray((params.sourceItem as any)?.lastSacrificedPermanents)
          && (params.sourceItem as any).lastSacrificedPermanents.length > 0
          ? {
              lastSacrificedPermanents: (params.sourceItem as any).lastSacrificedPermanents.map((entry: any) => ({ ...entry })),
            }
          : {}),
        ...oracleIrTargetBindingToBaseContext(targetBinding),
        selectorContext: {
          ...oracleIrTargetBindingToBaseContext(targetBinding).selectorContext,
          ...(chosenCreatureType ? { chosenCreatureType } : {}),
          ...(chosenColorName ? { chosenColor: chosenColorName } : {}),
          ...(chosenManaSymbol ? { chosenMana: chosenManaSymbol } : {}),
        },
        ...(chosenCreatureType ? { chosenCreatureType } : {}),
        ...(chosenColorName ? { chosenColor: chosenColorName } : {}),
      } as any,
      {
        ...oracleIrTargetBindingToEventHint(targetBinding),
        sourceObjectType: 'ability',
        ...(chosenCreatureType ? { chosenCreatureType } : {}),
      },
    );

    const gameId = String((ctx as any).gameId || 'unknown');
    const queueBefore = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : 0;

    const normalizedSelectedModeIds = normalizeOracleIrSelectedModeIds(steps, params.selectedModeIds);
    const executionOptions = {
      allowOptional: params.allowOptional ?? true,
      selectedModeIds: normalizedSelectedModeIds,
    };

    // Pattern B — same core EP gate as spells/triggers (modal / fateseal / clash / optional / prefixed).
    // Do not short-circuit on isReplaying here: activated abilities historically re-apply IR on
    // replay; EP resume/restore covers choice pauses via effectProgramReplayRestore.
    if (
      !(ctx as any).isReplaying
      && requiresSpellEffectProgramOrchestration(steps, normalizedSelectedModeIds)
    ) {
      const effectProgramResult = startOracleEffectProgramOnServer(ctx, {
        controller: params.controller,
        sourceName: params.sourceName,
        sourceId: params.sourcePermanentId || params.stackItemId,
        steps,
        irCtx,
        executionOptions,
        programIdPrefix: `activated:${params.sourcePermanentId || params.stackItemId || params.sourceName}`,
        metadata: {
          family: 'activated_ability_resolution',
          ...(params.sourceItem ? { triggerItem: params.sourceItem } : {}),
        },
      });
      if (effectProgramResult.handled) {
        const pendingOptional = Boolean(
          effectProgramResult.waitingForChoice && !effectProgramResult.completed,
        );
        debug(
          2,
          `[oracleIR] Effect Program ${pendingOptional ? 'queued choice for' : 'resolved'} activated ability from ${params.sourceName}`,
        );
        return {
          handled: true,
          applied: effectProgramResult.completed ? 1 : 0,
          pendingOptional,
        };
      }
    }

    const result = applyOracleIRStepsOnServer(ctx, state, steps, irCtx, executionOptions, {
      controller: params.controller,
      targetPlayerId: targetBinding.targetPlayerId,
      applyMillReplacements: true,
      sourceItem: params.sourceItem,
    });

    const queueAfter = gameId !== 'unknown'
      ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
      : queueBefore;

    const applied = result.appliedSteps.length;
    const pendingOptional = (result.pendingOptionalSteps || []).length > 0;
    const handled = isOracleIrActivatedAbilityHandled(steps, result, {
      resolutionQueueStepsBefore: queueBefore,
      resolutionQueueStepsAfter: queueAfter,
    });

    if (!handled) {
      logOracleIrAllOrNothingFailure(
        'activated',
        params.sourceName,
        describeOracleIrActivatedAbilityIncomplete(steps, result, {
          resolutionQueueStepsBefore: queueBefore,
          resolutionQueueStepsAfter: queueAfter,
        }),
        { applied, parsed: steps.length },
        { gameId: gameId !== 'unknown' ? gameId : undefined },
      );
    } else {
      debug(
        2,
        `[oracleIR] Applied ${applied} activated-ability step(s) for ${params.sourceName}` +
          (pendingOptional ? ` (${result.pendingOptionalSteps.length} optional pending)` : ''),
      );
    }

    return { handled, applied, pendingOptional };
  } catch (err) {
    debugWarn(1, `[oracleIR] Activated ability execution failed for ${params.sourceName}:`, err);
    return { handled: false, applied: 0, pendingOptional: false };
  }
}
