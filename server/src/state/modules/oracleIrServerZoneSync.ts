import type { PlayerID } from '../../../../shared/src/index.js';
import { copyAsEntersCopiableChoicesFromSource } from '../../../../shared/src/copyTokenUtils.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../rules-engine/src/oracleIR.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
  type OracleIRExecutionContext,
  type OracleIRExecutionOptions,
  type OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveSingleCreatureTargetId } from '../../../../rules-engine/src/oracleIRExecutorCreatureStepUtils.js';
import { resolveOracleQuantity, resolveOracleQuantityForPlayer } from '../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import { normalizeOracleManaCostString } from '../../../../rules-engine/src/oracleIRExecutorManaUtils.js';
import {
  getPlayableUntilTurnForImpulseDuration,
  impulseExileTopRequiresChooseOne,
  resolvePlayers,
} from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { buildSacrificeTargetSelectionOptions } from '../../../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import {
  collectDiscardSelectionOptionsForStep,
  buildExploreDecisionFromStep,
  buildLookChooseFromTopSelectionOptions,
  buildLookSelectTopSelectionOptions,
  buildMoveZoneSelectionOptions,
  buildPlayerChoiceAmongThemSelectionOptions,
  buildSearchLibrarySelectionOptions,
} from '../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { getProliferateChoiceTargets, buildPopulateTargetSelectionOptions, collectBlightTargetSelectionConfigs } from '../../../../rules-engine/src/oracleIRExecutorKeywordStepHandlers.js';
import { getExploreActionCount, getProliferateActionCount } from './keywordActionRepetition.js';
import { queueFlipCoinLifeStakesLoop } from './flipCoinLifeStakes.js';
import { ResolutionQueueManager, ResolutionStepStatus, ResolutionStepType } from '../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from './resolutionPromptEvents.js';
import { isOracleIrTriggerPrimaryEnabled } from './oracleIrTriggerExecution.js';
import { processSpellCounteredTriggers } from './spellCounteredTriggerUtils.js';
import {
  emitTriggersAfterOracleIRApply,
  snapshotBattlefieldForTriggerEmission,
} from './oracleIrPostApplyTriggerEmission.js';
import { queuePayLifeTriggers } from './triggers/pay-life.js';
import {
  detectTutorSpell,
  parseLibrarySearchFilter,
} from './oracleIrSpellLegacyTutorUtils.js';
import { isCelestialReunionOracle } from './chosen-creature-type.js';
import { evaluateCounterPlacementReplacementEvent, evaluateMillReplacementEvent } from './replacement-effects.js';
import { processMillTriggers } from './zones.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import {
  applyCopyPermanentTriggerStep,
  copyPermanentTriggerStepNeedsTargetSelectionQueue,
} from './trigger-copy-permanent.js';
import { queueCopySpellStackPushFromOracleIRResult } from './oracleIrServerCopySpellSync.js';
import { appendCopyTriggeredAbilityResolveEvent } from './triggerAbilityCopyUtils.js';
import { payManaCostWithAvailableSources } from '../../socket/util.js';
import {
  clearPreparedPermanent,
  setPermanentPrepared,
  syncPreparedPermanentAfterControlChange,
  resyncPreparedExileCopiesWithControllers,
} from './prepared.js';
import { scheduleExiledCardReturnToBattlefield } from './executeSpellEffect.js';
import { scheduleDelayedDrawAtNextUpkeep } from './triggerDelayedEffectUtils.js';
import { parseSimplePermanentTypeFromText } from '../../../../rules-engine/src/oracleIRExecutorBattlefieldParser.js';
import { isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt } from '../../../../rules-engine/src/oracleIRPerPlayerOptional.js';
import { hasExecutorClass } from '../../../../rules-engine/src/oracleIRExecutorPermanentUtils.js';
import { getNextEndStepFireTurnNumber } from './triggerDelayedEffectUtils.js';
import {
  isEachPlayerMayPutLandFromHandStep,
  isControllerMayPutLandFromHandStep,
  isBothPlayersMayPutPermanentFromHandStep,
  queueEachPlayerMayPutLandOrDrawBatch,
  queueControllerLandPlayOrDrawPrompt,
  queueLandPlayFromHandPrompt,
  queueBothPlayersMayPutPermanentFromHandPrompts,
} from './triggerLandPlayPromptUtils.js';
import { queueEachPlayerCounterPlacementPromptsFromOracleIRResult } from './triggerCounterPlacementPromptUtils.js';
import { bridgeGameStateOracleEffectsAfterOracleIR } from './triggerGameStateOracleBridgeUtils.js';
import { bridgeCreatedTokenEtbTriggersAfterOracleIR } from './triggerOracleIrTokenEtbBridge.js';
import {
  executeLibraryChaosExchange,
  permanentMatchesLibraryChaosTarget,
  queueLibraryChaosCastOffers,
  type LibraryChaosExchangeStep,
} from './oracleIrLibraryChaosExchange.js';
import {
  applyCounterModifications,
  updateCounters,
} from './counters_tokens.js';
import { syncDerivedContinuousEffects } from './staticEffectSpec.js';
import { mirrorGraveyardCastingPermissionsToDurable } from './graveyard-permissions.js';
import { syncCastingModifierGrantsFromOracleIRResult } from './casting-modifiers.js';
import { enrichTokenCardImages } from '../../services/tokens.js';
import { debugWarn } from '../../utils/debug.js';
import {
  createOracleIRServerExecutionBridge,
  queueOracleIrDeferredReplacementPrompts,
  clearOracleIrPendingCompoundResumeOnState,
  persistOracleIrCompoundDrawAfterResolution,
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
  resolveOracleIrChoiceStepIndex,
  resolveOracleIrContinuationStepIndex,
} from './oracleIrTransitionPipeline.js';
import { persistOracleIrReplayMutationsFromExecution, persistCounterDiffsFromOracleIR } from '../effects/effectProgramReplayMutationPersistence.js';
import {
  persistBattlefieldPermanentPatchesFromOracleIR,
  snapshotBattlefieldPermanentReplayPatches,
} from '../effects/battlefieldPermanentReplayPersistence.js';
import { createEmptyStepLedger } from '../../../../rules-engine/src/oracleIRStepLedger.js';
import type { OracleIRTransitionHaltState } from '../../../../rules-engine/src/oracleIRExecutionTypes.js';
import { resolveOracleIrBoundTargetSpellId } from '../../../../rules-engine/src/oracleIrTargetBinding.js';
import type { GameContext } from '../context.js';
import { registerLinkedExile } from './triggers/linked-exile.js';

type MutableOracleIRExecutionResult = {
  -readonly [K in keyof OracleIRExecutionResult]: OracleIRExecutionResult[K];
};

function enrichBattlefieldTokenImages(state: any): void {
  const cardsNeedingImages: any[] = [];
  for (const perm of state?.battlefield || []) {
    if (!perm?.isToken || !perm?.card) continue;
    const card = perm.card as any;
    if (card?.image_uris?.normal || card?.image_uris?.small) continue;
    cardsNeedingImages.push(card);
  }
  if (cardsNeedingImages.length === 0) return;
  void enrichTokenCardImages(cardsNeedingImages).catch((err) => {
    debugWarn(1, '[oracle-ir] enrichBattlefieldTokenImages failed (non-fatal):', err);
  });
}

/**
 * The live server stores libraries in ctx.libraries and zone summaries in state.zones,
 * while rules-engine Oracle IR reads/writes player.library on state.players.
 * Hydrate before IR execution and sync back afterward.
 */
/**
 * Clone ctx.libraries for Oracle IR shadow probes so draw/mill steps cannot mutate live game libraries.
 */
export function buildShadowProbeContext(ctx: GameContext): GameContext {
  const libraries = (ctx as any).libraries as Map<PlayerID, any[]> | undefined;
  const clonedLibraries = new Map<PlayerID, any[]>();
  if (libraries && typeof libraries.entries === 'function') {
    for (const [playerId, cards] of libraries.entries()) {
      clonedLibraries.set(
        playerId as PlayerID,
        Array.isArray(cards) ? cards.map((card) => ({ ...card })) : [],
      );
    }
  }
  return { ...(ctx as any), libraries: clonedLibraries } as GameContext;
}

export function hydrateOracleIRPlayerZonesFromContext(ctx: GameContext, state: any): void {
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const lifeFromState = state.life?.[playerId];
    if (typeof lifeFromState === 'number') {
      player.life = lifeFromState;
    }
  }

  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  if (!libraries || typeof libraries.get !== 'function') return;

  // Rules-engine zone ops can read/write through this map when player.library is empty.
  (state as any).__serverLibraries = libraries;

  const zones = state.zones || {};
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const library = libraries.get(playerId as PlayerID);
    if (Array.isArray(library)) {
      player.library = library.map((card: any) => ({ ...card, zone: card?.zone || 'library' }));
    }

    const playerZones = zones[playerId] || {};
    if (Array.isArray(playerZones.graveyard)) {
      player.graveyard = playerZones.graveyard.map((card: any) => ({ ...card, zone: card?.zone || 'graveyard' }));
    }
    if (Array.isArray(playerZones.hand)) {
      player.hand = playerZones.hand.map((card: any) => ({ ...card, zone: card?.zone || 'hand' }));
    }
    if (typeof playerZones.handCount === 'number' && Number.isFinite(playerZones.handCount)) {
      player.handCount = playerZones.handCount;
    }
    if (Array.isArray(playerZones.exile)) {
      player.exile = playerZones.exile.map((card: any) => ({ ...card, zone: card?.zone || 'exile' }));
    }
  }
}

export function snapshotGraveyardCardIds(state: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const zones = state.zones || {};
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const ids = new Set<string>();
    const zoneGraveyard = Array.isArray(zones[playerId]?.graveyard) ? zones[playerId].graveyard : [];
    const playerGraveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    for (const card of [...zoneGraveyard, ...playerGraveyard]) {
      const cardId = String(card?.id || '').trim();
      if (cardId) ids.add(cardId);
    }
    out.set(playerId, ids);
  }
  return out;
}

function snapshotExileCardIds(state: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  const zones = state.zones || {};
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const exile = Array.isArray(zones[playerId]?.exile)
      ? zones[playerId].exile
      : Array.isArray(player?.exile)
        ? player.exile
        : [];
    out.set(playerId, new Set(exile.map((card: any) => String(card?.id || '')).filter(Boolean)));
  }
  return out;
}

const DELAYED_UPKEEP_DRAW_COUNT_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

function parseDelayedUpkeepDrawCount(value: string, fallback = 1): number {
  const normalized = String(value || '').toLowerCase().trim();
  if (DELAYED_UPKEEP_DRAW_COUNT_WORDS[normalized] !== undefined) {
    return DELAYED_UPKEEP_DRAW_COUNT_WORDS[normalized];
  }
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isScheduleDelayedBattlefieldReturnStep(
  step: OracleEffectStep,
): step is Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }> {
  if (step.kind !== 'schedule_delayed_trigger') return false;
  const effect = String(step.effect || '').toLowerCase();
  return /\breturn\b/.test(effect) && /\bbattlefield\b/.test(effect);
}

function isScheduleDelayedUpkeepDrawStep(
  step: OracleEffectStep,
): step is Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }> {
  if (step.kind !== 'schedule_delayed_trigger') return false;
  const timing = String(step.timing || '').trim();
  if (timing !== 'next_upkeep' && timing !== 'your_next_upkeep') return false;

  const nestedSteps = Array.isArray((step as { steps?: readonly OracleEffectStep[] }).steps)
    ? (step as { steps?: readonly OracleEffectStep[] }).steps!
    : [];
  if (nestedSteps.some((nested) => nested.kind === 'draw')) return true;

  const effect = String(step.effect || '').toLowerCase();
  return /\bdraw\b/.test(effect);
}

function parseDelayedUpkeepDrawCountFromStep(
  step: Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }>,
): number {
  const nestedSteps = Array.isArray(step.steps) ? step.steps : [];
  const drawStep = nestedSteps.find((nested) => nested.kind === 'draw') as
    | Extract<OracleEffectStep, { kind: 'draw' }>
    | undefined;
  if (drawStep?.amount?.kind === 'number') {
    return Math.max(1, Math.floor(Number(drawStep.amount.value || 1)));
  }

  const effect = String(step.effect || '');
  const match = effect.match(/\bdraw\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+cards?\b/i);
  if (match) return parseDelayedUpkeepDrawCount(match[1], 1);
  if (/\bdraw a card\b/i.test(effect)) return 1;
  return 1;
}

function mapDelayedTriggerTimingToFlickerReturnAt(
  timing: string | undefined,
): 'next_end_step' | 'owners_next_end_step' | 'end_of_combat' {
  const normalized = String(timing || '').trim();
  if (normalized === 'your_next_end_step') return 'owners_next_end_step';
  if (normalized === 'end_of_combat') return 'end_of_combat';
  return 'next_end_step';
}

function findLastNewlyExiledCard(
  state: any,
  exileBefore: Map<string, Set<string>>,
): { ownerId: PlayerID; cardId: string } | null {
  const zones = state.zones || {};
  let last: { ownerId: PlayerID; cardId: string } | null = null;

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const beforeIds = exileBefore.get(playerId) || new Set<string>();
    const exile = Array.isArray(zones[playerId]?.exile)
      ? zones[playerId].exile
      : Array.isArray(player?.exile)
        ? player.exile
        : [];

    for (const card of exile) {
      const cardId = String(card?.id || '').trim();
      if (cardId && !beforeIds.has(cardId)) {
        last = { ownerId: playerId as PlayerID, cardId };
      }
    }
  }

  return last;
}

function bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const delayedDrawSteps = (result.appliedSteps || []).filter(isScheduleDelayedUpkeepDrawStep);
  if (delayedDrawSteps.length === 0) return;

  const playerId = String(params.controller || '').trim();
  if (!playerId) return;

  const sourceName = String(params.sourceName || 'Delayed trigger').trim() || 'Delayed trigger';
  const sourceId = String(params.sourceId || '').trim() || undefined;

  for (const step of delayedDrawSteps) {
    scheduleDelayedDrawAtNextUpkeep(ctx, {
      playerId,
      sourceName,
      sourceId,
      count: parseDelayedUpkeepDrawCountFromStep(step),
    });
  }
}

function bridgeScheduleDelayedFlickerReturnsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  exileBefore: Map<string, Set<string>>,
  params: {
    sourceName?: string;
  },
): void {
  const delayedReturnSteps = (result.appliedSteps || []).filter(isScheduleDelayedBattlefieldReturnStep);
  if (delayedReturnSteps.length === 0) return;

  const hadExileStep = (result.appliedSteps || []).some((step) => {
    if (step.kind === 'exile') return true;
    return step.kind === 'move_zone' && String((step as any).to || '') === 'exile';
  });
  if (!hadExileStep) return;

  const exiled = findLastNewlyExiledCard(state, exileBefore);
  if (!exiled) return;

  const sourceName = String(params.sourceName || 'Flicker effect').trim() || 'Flicker effect';
  for (const step of delayedReturnSteps) {
    const returnAt = mapDelayedTriggerTimingToFlickerReturnAt(step.timing);
    scheduleExiledCardReturnToBattlefield(ctx, exiled.ownerId, exiled.cardId, returnAt, sourceName);
  }
}

export function syncOracleIRPlayerZonesToContext(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  graveyardBefore: Map<string, Set<string>>,
): void {
  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  const canSyncLibraries = Boolean(libraries && typeof libraries.set === 'function');

  const zones = state.zones = state.zones || {};
  let changed = false;

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    if (typeof player.life === 'number') {
      state.life = state.life || {};
      state.life[playerId] = player.life;
      changed = true;
    }

    const playerZones = zones[playerId] = zones[playerId] || {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      libraryCount: 0,
    };

    if (Array.isArray(player.hand)) {
      playerZones.hand = [...player.hand];
      if (player.hand.length > 0) {
        playerZones.handCount = player.hand.length;
      } else if (typeof playerZones.handCount !== 'number') {
        playerZones.handCount = 0;
      }
      changed = true;
    }

    if (Array.isArray(player.graveyard)) {
      const previousIds = graveyardBefore.get(playerId) || new Set<string>();
      const newlyMilled = player.graveyard.filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        return cardId && !previousIds.has(cardId);
      });

      playerZones.graveyard = [...player.graveyard];
      playerZones.graveyardCount = player.graveyard.length;
      changed = true;

      for (const card of newlyMilled) {
        recordCardPutIntoGraveyardThisTurn(ctx, playerId, card, { fromBattlefield: false });
      }
      if (newlyMilled.length > 0) {
        try {
          processMillTriggers(ctx, playerId, newlyMilled, controller);
        } catch {
          // best-effort
        }
      }
    }

    if (Array.isArray(player.exile)) {
      playerZones.exile = [...player.exile];
      playerZones.exileCount = player.exile.length;
      changed = true;
    }

    if (!canSyncLibraries) continue;

    if (Array.isArray(player.library)) {
      libraries.set(playerId as PlayerID, [...player.library]);
      playerZones.library = [...player.library];
      playerZones.libraryCount = player.library.length;
      changed = true;
    }
  }

  delete (state as any).__serverLibraries;

  if (changed && typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }
}

function snapshotBattlefieldControllers(state: any): Map<string, string> {
  const out = new Map<string, string>();
  for (const perm of state.battlefield || []) {
    const id = String(perm?.id || '').trim();
    const controllerId = String(perm?.controller || '').trim();
    if (id && controllerId) {
      out.set(id, controllerId);
    }
  }
  return out;
}

function snapshotBattlefieldCounters(state: any): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>();
  for (const perm of state.battlefield || []) {
    const id = String(perm?.id || '').trim();
    if (!id) continue;
    out.set(id, { ...((perm?.counters || {}) as Record<string, number>) });
  }
  return out;
}

function syncCounterReplacementEffectsAfterOracleIR(
  ctx: GameContext,
  state: any,
  countersBefore: Map<string, Record<string, number>>,
): void {
  const pendingUpdates: Array<{ permanentId: string; deltas: Record<string, number> }> = [];

  for (const perm of state.battlefield || []) {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId) continue;

    const oldCounters = countersBefore.get(permanentId) || {};
    const newCounters = (perm?.counters || {}) as Record<string, number>;
    const counterKeys = new Set([...Object.keys(oldCounters), ...Object.keys(newCounters)]);
    const bonusDeltas: Record<string, number> = {};

    for (const counterType of counterKeys) {
      const oldCount = Number(oldCounters[counterType] || 0);
      const newCount = Number(newCounters[counterType] || 0);
      const rawDelta = newCount - oldCount;
      if (rawDelta <= 0) continue;

      const replacementResult = evaluateCounterPlacementReplacementEvent({
        state,
        targetPermanentId: permanentId,
        controllerId: perm.controller,
        deltas: { [counterType]: rawDelta },
      });
      const modifiedDeltas = (replacementResult.metadata as { modifiedDeltas?: Record<string, number> } | undefined)?.modifiedDeltas;
      const modifiedDelta = Number(modifiedDeltas?.[counterType] ?? rawDelta);
      if (modifiedDelta <= rawDelta) continue;

      // Oracle IR already applied rawDelta directly to state; add only the replacement bonus.
      bonusDeltas[counterType] = (bonusDeltas[counterType] || 0) + (modifiedDelta - rawDelta);
    }

    if (Object.keys(bonusDeltas).length === 0) continue;
    pendingUpdates.push({ permanentId, deltas: bonusDeltas });
  }

  for (const { permanentId, deltas } of pendingUpdates) {
    updateCounters(ctx, permanentId, deltas, {
      deferRunSBA: true,
      skipCounterModifications: true,
      skipEventPersistence: true,
    });
  }
}

function syncPreparedCopiesAfterBattlefieldControllerChanges(
  state: any,
  controllersBefore: Map<string, string>,
): void {
  for (const perm of state.battlefield || []) {
    const id = String(perm?.id || '').trim();
    if (!id) continue;
    const previousController = controllersBefore.get(id);
    const currentController = String(perm?.controller || '').trim();
    if (!previousController || !currentController || previousController === currentController) {
      continue;
    }
    syncPreparedPermanentAfterControlChange(state, perm, previousController);
  }
}

function syncPreparedCopiesFromControlChangeEffects(state: any): void {
  const effects = Array.isArray(state.controlChangeEffects) ? state.controlChangeEffects : [];
  for (const effect of effects) {
    const permanentId = String(effect?.permanentId || '').trim();
    const previousController = String(effect?.originalController || '').trim();
    if (!permanentId || !previousController) continue;
    const perm = (state.battlefield || []).find((entry: any) => String(entry?.id || '').trim() === permanentId);
    if (!perm) continue;
    syncPreparedPermanentAfterControlChange(state, perm, previousController);
  }
}

function resolveMillTargetPlayerId(
  who: any,
  controller: PlayerID,
  targetPlayerId: PlayerID | undefined,
  state: any,
): PlayerID | undefined {
  if (who?.kind === 'target_player' || who?.kind === 'target_opponent') {
    return targetPlayerId;
  }
  if (who?.kind === 'you') {
    return controller;
  }
  if (who?.kind === 'each_opponent') {
    const opponents = (state.players || [])
      .map((player: any) => String(player?.id || '').trim())
      .filter((id: string) => id && id !== String(controller));
    return opponents.length === 1 ? (opponents[0] as PlayerID) : undefined;
  }
  return targetPlayerId;
}

export function applyMillReplacementEffectsToSteps(
  ctx: GameContext,
  steps: OracleEffectStep[],
  controller: PlayerID,
  targetPlayerId: PlayerID | undefined,
  state: any,
  irCtx: OracleIRExecutionContext,
): OracleEffectStep[] {
  return steps.map((step) => {
    if (step.kind !== 'mill') return step;

    const millTarget = resolveMillTargetPlayerId((step as any).who, controller, targetPlayerId, state);
    if (!millTarget) return step;

    const baseCount = resolveOracleQuantity(
      state,
      controller,
      (step as any).amount as OracleQuantity,
      irCtx,
      { whereX: (step as any).whereX },
    );
    if (baseCount === null || baseCount <= 0) return step;

    const millResult = evaluateMillReplacementEvent({
      ctx,
      state,
      millingPlayerId: String(controller),
      targetPlayerId: String(millTarget),
      count: baseCount,
    });
    const finalCount = millResult.replacementAmount ?? baseCount;
    if (finalCount === baseCount) return step;

    return {
      ...step,
      amount: { kind: 'number', value: finalCount, raw: String(finalCount) },
    } as OracleEffectStep;
  });
}

function normalizeTopLibraryPromptCard(card: any): Record<string, unknown> {
  return {
    id: String(card?.id || ''),
    name: String(card?.name || card?.card?.name || card?.id || 'Unknown Card'),
    type_line: card?.type_line || card?.card?.type_line,
    oracle_text: card?.oracle_text || card?.card?.oracle_text,
    imageUrl: card?.image_uris?.normal || card?.imageUrl,
    mana_cost: card?.mana_cost || card?.card?.mana_cost,
    cmc: card?.cmc ?? card?.card?.cmc,
  };
}

function isOpponentDrawIfDidntPutLandConditional(step: OracleEffectStep): boolean {
  if (step.kind !== 'conditional') return false;
  const raw = String(step.condition?.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  return raw === "each opponent who didn't";
}

function isControllerDrawIfDidntPutLandConditional(step: OracleEffectStep): boolean {
  if (step.kind !== 'conditional') return false;
  const raw = String(step.condition?.raw || '').replace(/\u2019/g, "'").trim().toLowerCase();
  if (raw !== "you don't" && raw !== 'you do not') return false;
  const innerSteps = Array.isArray((step as any).steps) ? (step as any).steps : [];
  return innerSteps.some((inner: OracleEffectStep) => inner.kind === 'draw');
}

function queueControllerMayPutLandFromHandPromptsFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
  },
): void {
  const landStep = [...(result.skippedSteps || []), ...(result.pendingOptionalSteps || [])]
    .find((step) => isControllerMayPutLandFromHandStep(step));
  if (!landStep) return;

  const landStepRaw = String((landStep as any).raw || '').replace(/\u2019/g, "'");
  const hasDrawFallback = /if you don(?:'|')?t,?\s*draw a card/i.test(landStepRaw)
    || (result.pendingContinuationSteps || []).some((step) => isControllerDrawIfDidntPutLandConditional(step));
  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';

  if (hasDrawFallback) {
    queueControllerLandPlayOrDrawPrompt(
      ctx,
      params.controller,
      sourceName,
      params.triggerItem,
    );
  } else {
    queueLandPlayFromHandPrompt(
      ctx,
      params.controller,
      sourceName,
      params.triggerItem,
    );
  }

  if (Array.isArray(result.pendingContinuationSteps) && result.pendingContinuationSteps.length > 0) {
    const filtered = result.pendingContinuationSteps.filter(
      (step) => !isControllerDrawIfDidntPutLandConditional(step),
    );
    if (filtered.length !== result.pendingContinuationSteps.length) {
      (result as MutableOracleIRExecutionResult).pendingContinuationSteps = filtered;
    }
  }
}

function queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
  },
): void {
  const landStep = [...(result.skippedSteps || []), ...(result.pendingOptionalSteps || [])]
    .find((step) => isEachPlayerMayPutLandFromHandStep(step));
  if (!landStep) return;

  const gameId = String((ctx as any).gameId || '').trim();
  const batchId = String(params.triggerItem?.id || `land_play_ir_${Date.now()}`);
  if (gameId && gameId !== 'unknown') {
    const hasPendingBatch = ResolutionQueueManager.getQueue(gameId).steps.some(
      (queuedStep) =>
        queuedStep.type === ResolutionStepType.KYNAIOS_CHOICE
        && queuedStep.status === ResolutionStepStatus.PENDING
        && String((queuedStep as any).kynaiosBatchId || '') === batchId,
    );
    if (hasPendingBatch) return;
  }

  const queued = queueEachPlayerMayPutLandOrDrawBatch(ctx, {
    sourceController: params.controller,
    sourceName: String(params.sourceName || 'Ability').trim() || 'Ability',
    sourceId: params.sourceId,
    batchId,
    triggerItem: params.triggerItem,
  });
  if (!queued) return;

  if (Array.isArray(result.pendingContinuationSteps) && result.pendingContinuationSteps.length > 0) {
    const filtered = result.pendingContinuationSteps.filter(
      (step) => !isOpponentDrawIfDidntPutLandConditional(step),
    );
    if (filtered.length !== result.pendingContinuationSteps.length) {
      (result as MutableOracleIRExecutionResult).pendingContinuationSteps = filtered;
    }
  }
}

function queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult(
  ctx: GameContext,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    triggerItem?: any;
    irCtx?: OracleIRExecutionContext;
  },
): void {
  const step = [
    ...(result.appliedSteps || []),
    ...(result.skippedSteps || []),
    ...(result.pendingOptionalSteps || []),
  ].find((candidate) => isBothPlayersMayPutPermanentFromHandStep(candidate));
  if (!step) return;

  const targetPlayerId = String(
    params.triggerItem?.targetPlayerId ||
      params.triggerItem?.effectData?.targetPlayerId ||
      params.triggerItem?.targets?.[0]?.id ||
      params.triggerItem?.targets?.[0] ||
      params.irCtx?.selectorContext?.targetPlayerId ||
      params.irCtx?.targetPlayerId ||
      '',
  ).trim() as PlayerID;
  if (!targetPlayerId) return;

  queueBothPlayersMayPutPermanentFromHandPrompts(ctx, {
    controller: params.controller,
    targetPlayerId,
    sourceName: String(params.sourceName || 'Ability').trim() || 'Ability',
    triggerItem: params.triggerItem,
  });
}

function filterNonExecutableOracleIrResumeSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  return steps.filter((step) => {
    if (step.kind !== 'grant_static_ability') return true;
    const targetText = String((step.target as any)?.text || '').trim();
    if (targetText !== 'pass36 residual') return true;
    return !/^if x is \d+ or more, instead put the chosen cards/i.test(String(step.raw || '').trim());
  });
}

function unwrapYouDoResumeSteps(steps: readonly OracleEffectStep[]): OracleEffectStep[] {
  const unwrapped = (() => {
    if (steps.length === 1 && steps[0]?.kind === 'conditional') {
      const conditionRaw = String((steps[0] as any)?.condition?.raw || '')
        .replace(/\u2019/g, "'")
        .trim()
        .toLowerCase();
      if (conditionRaw === 'you do' || conditionRaw.startsWith('you do,')) {
        const nested = (steps[0] as any)?.steps;
        if (Array.isArray(nested) && nested.length > 0) {
          return nested as OracleEffectStep[];
        }
      }
    }
    return [...steps];
  })();
  return filterNonExecutableOracleIrResumeSteps(unwrapped);
}

function attachOracleIrResumeMetadata(
  payload: Record<string, unknown>,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    irCtx?: OracleIRExecutionContext;
  },
): Record<string, unknown> {
  const xValue = Number(params.irCtx?.xValue);
  const xValuePayload = Number.isFinite(xValue) ? { oracleIrXValue: xValue } : {};
  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending.length === 0) {
    return {
      ...payload,
      ...xValuePayload,
    };
  }

  return {
    ...payload,
    ...xValuePayload,
    oracleIrResumeStepsJson: JSON.stringify(unwrapYouDoResumeSteps(pending)),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
  };
}

function queueTopLibraryChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    const kind = String(gap.stepKind || '');
    if (kind !== 'scry' && kind !== 'surveil') continue;

    const step = (result.skippedSteps || []).find(
      (candidate) =>
        String(candidate.kind || '') === kind &&
        String((candidate as any).raw || '') === String(gap.raw || '')
    ) as OracleEffectStep | undefined;
    if (!step) continue;

    const playerIds = [...resolvePlayers(state, (step as any).who, params.irCtx)];
    for (const playerId of playerIds) {
      const count = resolveOracleQuantityForPlayer(
        state,
        params.controller,
        (step as any).amount as OracleQuantity,
        params.irCtx,
        playerId,
        { whereX: (step as any).whereX },
      );
      if (count === null || count <= 0) continue;

      const queueKey = `${kind}:${playerId}:${String((step as any).raw || '')}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
      const library = Array.isArray(libraries?.get?.(playerId))
        ? libraries.get(playerId)!
        : Array.isArray(
            (state.players || []).find((player: any) => String(player?.id || '') === playerId)?.library
          )
          ? (state.players || []).find((player: any) => String(player?.id || '') === playerId).library
          : [];
      const actualCount = Math.min(count, library.length);
      if (actualCount <= 0) continue;

      const cards = library.slice(0, actualCount).map(normalizeTopLibraryPromptCard);

      if (kind === 'scry') {
        const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.SCRY,
          playerId,
          description: `${sourceName}: Scry ${actualCount}`,
          mandatory: true,
          sourceId,
          sourceName,
          scryCount: actualCount,
          cards,
          persistOracleIrScryResolve: true,
          persistOracleIrScryResolveReason: 'stack_resolution',
          oracleIrChoiceStepJson: JSON.stringify([step]),
          oracleIrControllerId: params.controller,
          oracleIrSourceId: sourceId,
          oracleIrSourceName: sourceName,
        } as any, result, params) as any);
        appendQueuedResolutionPromptEvent(ctx, {
          playerId,
          sourceId,
          queuedResolutionStep: queuedStep,
        });
        continue;
      }

      const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.SURVEIL,
        playerId,
        description: `${sourceName}: Surveil ${actualCount}`,
        mandatory: true,
        sourceId,
        sourceName,
        surveilCount: actualCount,
        cards,
        persistOracleIrSurveilResolve: true,
        persistOracleIrSurveilResolveReason: 'stack_resolution',
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId,
        sourceId,
        queuedResolutionStep: queuedStep,
      });
    }
  }
}

function mergeOracleIrContinuationResult(
  target: OracleIRExecutionResult,
  continuation: OracleIRExecutionResult,
): void {
  const mutable = target as MutableOracleIRExecutionResult;
  mutable.appliedSteps = [...mutable.appliedSteps, ...continuation.appliedSteps];
  mutable.skippedSteps = continuation.skippedSteps;
  mutable.pendingOptionalSteps = continuation.pendingOptionalSteps;
  mutable.pendingContinuationSteps = continuation.pendingContinuationSteps;
  mutable.automationGaps = continuation.automationGaps;
}

function queueSacrificeChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    targetPlayerId?: PlayerID;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();
  let hadUnqueueableSacrificeGap = false;
  const fizzledSacrificeSteps: OracleEffectStep[] = [];

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'sacrifice') continue;

    const step = (result.skippedSteps || []).find(
      (candidate) =>
        candidate.kind === 'sacrifice' &&
        String((candidate as any).raw || '') === String(gap.raw || '')
    ) as OracleEffectStep | undefined;
    if (!step || step.kind !== 'sacrifice') continue;

    const built = buildSacrificeTargetSelectionOptions(state, step, params.irCtx);
    if (!built || built.options.length === 0) {
      hadUnqueueableSacrificeGap = true;
      fizzledSacrificeSteps.push(step);
      continue;
    }

    const queueKey = `sacrifice:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const choosingPlayerId =
      resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;

    const stepRaw = String((step as any).raw || '');
    const sacrificeWhatText = String((step as any)?.what?.text || (step as any)?.what?.raw || '').trim();
    const isAnnihilatorStyleSacrifice =
      /\bdefending player sacrifices\b/i.test(stepRaw)
      || (/\bannihilator\b/i.test(params.sourceName || '') && /\bpermanents?\b/i.test(sacrificeWhatText));
    const annihilatorCountMatch = sacrificeWhatText.match(/^(\d+)\s+permanents?$/i);
    const annihilatorRequiredCount = annihilatorCountMatch
      ? Math.max(1, Number.parseInt(String(annihilatorCountMatch[1] || '1'), 10))
      : built.minTargets;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: choosingPlayerId,
      description: `${sourceName}: ${String((step as any).raw || 'Sacrifice')}`,
      mandatory: true,
      sourceId,
      sourceName,
      validTargets: built.options,
      targetTypes: ['permanent'],
      minTargets: built.minTargets,
      maxTargets: built.maxTargets,
      targetDescription: String((step as any).raw || 'Choose permanents to sacrifice'),
      ...(isAnnihilatorStyleSacrifice
        ? {
          annihilatorChoice: true,
          sacrificeSelection: true,
          sacrificePermanentType: 'permanent',
          sacrificeCount: built.minTargets,
          sacrificeReason: `${sourceName}'s Annihilator ${annihilatorRequiredCount} triggered`,
          sacrificeSourceName: sourceName,
        }
        : {}),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }

  if (!hadUnqueueableSacrificeGap) return;

  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending.length === 0) return;

  const continuationResult = resumeOracleIRRemainingStepsFromResolution(ctx, {
    controller: params.controller,
    sourceId,
    sourceName,
    steps: pending,
    targetPlayerId: params.targetPlayerId,
    triggerItem: params.triggerItem,
  });
  if (!continuationResult) return;

  mergeOracleIrContinuationResult(result, continuationResult);
  if (fizzledSacrificeSteps.length > 0) {
    const mutable = result as MutableOracleIRExecutionResult;
    mutable.appliedSteps = [...mutable.appliedSteps, ...fizzledSacrificeSteps];
  }
}

function queueDiscardChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'discard') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'discard') continue;

    const builtPrompts = collectDiscardSelectionOptionsForStep(state, step, params.irCtx);
    for (const built of builtPrompts) {
      if (!built || built.options.length === 0) continue;
      const isAnyNumberDiscard = built.anyNumberDiscard === true;
      if (!isAnyNumberDiscard && built.discardCount <= 0) continue;

      const queueKey = `discard:${String((step as any).raw || '')}:${built.playerId}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      try {
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, built.playerId)
          .find(
            (candidate) =>
              candidate.type === ResolutionStepType.DISCARD_SELECTION &&
              sourceId &&
              String((candidate as any)?.sourceId || '') === sourceId &&
              String((candidate as any)?.description || '').includes(String((step as any).raw || ''))
          );
        if (existing) continue;
      } catch {
        // ignore
      }

      const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.DISCARD_SELECTION,
        playerId: built.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Discard')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        hand: built.options,
        discardCount: built.discardCount,
        minDiscardCount: built.minDiscardCount,
        maxDiscardCount: built.maxDiscardCount,
        anyNumberDiscard: built.anyNumberDiscard === true,
        currentHandSize: built.currentHandSize,
        maxHandSize: built.maxHandSize,
        reason: 'effect',
      } as any, result, params) as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId: built.playerId,
        sourceId,
        queuedResolutionStep: queuedStep,
      });
    }
  }
}

function queueProliferateChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'proliferate') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'proliferate') continue;

    const availableTargets = getProliferateChoiceTargets(state);
    if (availableTargets.length <= 1) continue;

    const choosingPlayerId =
      resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;

    const skipReplacement = (step as any).skipProliferateReplacement === true
      || (gap.metadata as any)?.skipProliferateReplacement === true;
    const actionCount = getProliferateActionCount(state?.battlefield, choosingPlayerId, { skipReplacement });

    for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
      const queueKey = `proliferate:${String((step as any).raw || '')}:${choosingPlayerId}:${actionIndex}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      try {
        const proliferateId = `${sourceId || sourceName}:${String((step as any).raw || 'proliferate')}:${actionIndex}`;
        const existing = ResolutionQueueManager
          .getStepsForPlayer(gameId, choosingPlayerId)
          .find(
            (candidate) =>
              candidate.type === ResolutionStepType.PROLIFERATE &&
              sourceId &&
              String((candidate as any)?.sourceId || '') === sourceId &&
              String((candidate as any)?.proliferateId || '') === proliferateId
          );
        if (existing) continue;

        ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.PROLIFERATE,
          playerId: choosingPlayerId,
          description: actionCount > 1
            ? `${sourceName}: ${String((step as any).raw || 'Proliferate')} (${actionIndex + 1}/${actionCount})`
            : `${sourceName}: ${String((step as any).raw || 'Proliferate')}`,
          mandatory: (step as any).optional !== true,
          sourceId,
          sourceName,
          proliferateId,
          // Replacement-created actions do not re-apply Tekuthal (CR 614.5).
          skipProliferateReplacement: true,
          availableTargets: availableTargets.map((target) => ({
            id: target.id,
            name: target.name,
            counters: { ...target.counters },
            isPlayer: target.isPlayer,
            type: target.type,
            ...(target.controller ? { controller: target.controller } : {}),
          })),
        } as any, result, params) as any);
      } catch {
        // ignore
      }
    }
  }
}

function readServerPlayerLifeTotal(state: any, playerId: string): number {
  const normalizedId = String(playerId || '').trim();
  if (!normalizedId) return 0;
  const lifeRecord = state?.life;
  if (lifeRecord && Number.isFinite(Number(lifeRecord[normalizedId]))) {
    return Math.max(0, Math.floor(Number(lifeRecord[normalizedId])));
  }
  const player = (state?.players || []).find((entry: any) => String(entry?.id || '').trim() === normalizedId);
  if (player && Number.isFinite(Number(player.life))) {
    return Math.max(0, Math.floor(Number(player.life)));
  }
  return Math.max(0, Math.floor(Number(state?.startingLife ?? 40)));
}

function queueRedistributeLifeTotalsPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'redistribute_life_totals') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'redistribute_life_totals') continue;

    const players = (state?.players || [])
      .map((player: any) => {
        const id = String(player?.id || '').trim();
        if (!id) return null;
        return {
          id,
          name: String(player?.name || id).trim() || id,
          life: readServerPlayerLifeTotal(state, id),
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; life: number }>;

    if (players.length <= 1) continue;

    const choosingPlayerId = params.controller;
    const queueKey = `redistribute_life:${String((step as any).raw || '')}:${choosingPlayerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    try {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, choosingPlayerId)
        .find(
          (candidate) =>
            candidate.type === ResolutionStepType.LIFE_REDISTRIBUTION &&
            sourceId &&
            String((candidate as any)?.sourceId || '') === sourceId &&
            String((candidate as any)?.description || '').includes(String((step as any).raw || '')),
        );
      if (existing) continue;
    } catch {
      // ignore
    }

    const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.LIFE_REDISTRIBUTION,
      playerId: choosingPlayerId,
      description: `${sourceName}: ${String((step as any).raw || 'Redistribute life totals')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      redistributionId: `${sourceId || sourceName}:${String((step as any).raw || 'redistribute_life')}`,
      players,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
    appendQueuedResolutionPromptEvent(ctx, {
      playerId: choosingPlayerId,
      sourceId,
      queuedResolutionStep: queuedStep,
    });
  }
}

function queueFlipCoinLifeStakesPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'flip_coin_life_stakes') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'flip_coin_life_stakes') continue;

    const controllerId = resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;
    let opponentId =
      String((params.irCtx as any)?.targetOpponentId || (params.irCtx as any)?.targetPlayerId || '').trim();
    if (!opponentId) {
      const opponents = (Array.isArray(state?.players) ? state.players : [])
        .map((player: any) => String(player?.id || '').trim())
        .filter((id: string) => id && id !== String(controllerId));
      opponentId = opponents[0] || '';
    }
    if (!opponentId) continue;

    const stake = Math.max(1, Math.floor(Number((step as any).initialStake || 1) || 1));
    queueFlipCoinLifeStakesLoop(ctx, {
      controllerId: String(controllerId),
      opponentId,
      stake,
      sourceName: String(params.sourceName || 'Ability'),
      sourceId: params.sourceId,
      flipIndex: 0,
      doubleEachFlip: (step as any).doubleEachFlip !== false,
    });
  }
}

function queueExploreChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'explore') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'explore') continue;

    const built = buildExploreDecisionFromStep(state, step, params.irCtx);
    if (!built) continue;

    const gapMetadata = (gap.metadata || {}) as Record<string, unknown>;
    const remainingPermanentIds = Array.isArray(gapMetadata.remainingPermanentIds)
      ? gapMetadata.remainingPermanentIds
          .map((id: unknown) => String(id || '').trim())
          .filter((id: string) => id.length > 0)
      : [];

    const skipReplacement = (step as any).skipExploreReplacement === true
      || (gap.metadata as any)?.skipExploreReplacement === true;
    const exploreController = String(built.playerId || params.controller || '');
    const actionCount = getExploreActionCount(state?.battlefield, exploreController, { skipReplacement });

    for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
      const queueKey = `explore:${String((step as any).raw || '')}:${built.permanentId}:${actionIndex}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.EXPLORE_DECISION,
        playerId: built.playerId,
        description: actionCount > 1
          ? `${sourceName}: ${built.permanentName} explores (${actionIndex + 1}/${actionCount})`
          : `${sourceName}: ${built.permanentName} explores`,
        mandatory: (step as any).optional !== true,
        sourceId: built.permanentId,
        sourceName: built.permanentName,
        permanentId: built.permanentId,
        permanentName: built.permanentName,
        revealedCard: built.revealedCard,
        isLand: built.isLand,
        skipExploreReplacement: true,
        ...(remainingPermanentIds.length > 0 ? { remainingPermanentIds } : {}),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
    }
  }
}

function queueBlightChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'blight') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'blight') continue;

    const configs = collectBlightTargetSelectionConfigs(state, step, params.irCtx);
    if (configs.length === 0) continue;

    const stepConfigs = configs.map((config) => {
      const queueKey = `blight:${String((step as any).raw || '')}:${config.playerId}`;
      if (queuedKeys.has(queueKey)) return null;
      queuedKeys.add(queueKey);

      return attachOracleIrResumeMetadata({
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: config.playerId,
        description: `${sourceName}: Blight ${config.count} — choose a creature you control to put ${config.count} -1/-1 counter${config.count === 1 ? '' : 's'} on it.`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        validTargets: [...config.validTargets],
        targetTypes: ['creature'],
        minTargets: 1,
        maxTargets: 1,
        targetDescription: 'creature you control',
        keywordBlight: true,
        keywordBlightStage: 'select_target',
        keywordBlightController: config.playerId,
        keywordBlightN: config.count,
        keywordBlightSourceName: `${sourceName}: Blight ${config.count}`,
      } as any, result, params) as any;
    }).filter(Boolean) as any[];

    if (stepConfigs.length === 0) continue;

    if (stepConfigs.length === 1) {
      ResolutionQueueManager.addStep(gameId, stepConfigs[0]);
      continue;
    }

    const players = (state as any).players || [];
    const turnOrder: PlayerID[] = players
      .map((player: any) => player?.id)
      .filter((id: unknown) => typeof id === 'string') as PlayerID[];
    const activePlayerId: PlayerID =
      (state as any).turnPlayer ||
      (state as any).activePlayerId ||
      players[(state as any).activePlayerIndex || 0]?.id ||
      params.controller;

    ResolutionQueueManager.addStepsWithAPNAP(
      gameId,
      stepConfigs,
      turnOrder,
      activePlayerId,
    );
  }
}

function queuePopulateChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'populate') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'populate') continue;

    const built = buildPopulateTargetSelectionOptions(state, step, params.irCtx);
    if (!built || built.options.length <= 1) continue;

    const queueKey = `populate:${String((step as any).raw || '')}:${built.playerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: built.playerId,
      description: `${sourceName}: ${String((step as any).raw || 'Populate')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      validTargets: built.options,
      targetTypes: ['creature token'],
      minTargets: built.minTargets,
      maxTargets: built.maxTargets,
      targetDescription: String((step as any).raw || 'Choose a creature token to populate'),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function queueLookChooseChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    triggerItem?: any;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    const kind = String(gap.stepKind || '');
    if (kind !== 'look_choose_from_top' && kind !== 'look_select_top') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step) continue;

    if (step.kind === 'look_choose_from_top') {
      const built = buildLookChooseFromTopSelectionOptions(state, step, params.irCtx);
      if (!built || built.availableCards.length === 0) continue;

      const queueKey = `look_choose:${String((step as any).raw || '')}:${built.playerId}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      const availableCards = built.availableCards.map(normalizeTopLibraryPromptCard);
      const selectableIds = new Set(built.selectableCardIds);
      const nonSelectableCards = availableCards.filter((card) => !selectableIds.has(String(card.id || '')));
      const stepRaw = String((step as any).raw || '');
      const isRevealUntil = (step as any).amount?.kind === 'reference_amount';
      const attachSelectedEquipmentToPermanentId = built.destination === 'battlefield'
        && /attached to that creature/i.test(stepRaw)
        ? String(
          params.triggerItem?.effectData?.exertedPermanentId
          || params.triggerItem?.exertedPermanentId
          || '',
        ).trim() || undefined
        : undefined;
      const queuedAvailableCards = isRevealUntil && selectableIds.size > 0
        ? availableCards.filter((card) => selectableIds.has(String(card.id || '')))
        : availableCards;

      const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: built.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Look and choose')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        searchCriteria: built.destination === 'battlefield' && built.contextValue !== undefined
          ? `Top ${built.lookedCount} cards - creature card with mana value ${built.contextValue} or less`
          : String((step as any).raw || 'Look at the top cards of your library'),
        minSelections: built.minSelections,
        maxSelections: built.maxSelections,
        destination: built.destination === 'exile'
          ? 'exile'
          : built.destination === 'battlefield'
            ? 'battlefield'
            : 'hand',
        reveal: Boolean((step as any).reveal),
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: built.restOrder !== 'any',
        remainderPlayerChoosesOrder: built.restOrder === 'any',
        availableCards: queuedAvailableCards,
        nonSelectableCards,
        filter: built.filter,
        ...(attachSelectedEquipmentToPermanentId
          ? {
              attachSelectedEquipmentToPermanentId,
              persistLibrarySearchResolve: true,
              persistLibrarySearchResolveReason: 'stack_resolution',
            }
          : {}),
        ...(built.contextValue !== undefined ? { contextValue: built.contextValue } : {}),
        ...(attachSelectedEquipmentToPermanentId
          ? {}
          : {
              oracleIrChoiceStepJson: JSON.stringify([step]),
              oracleIrControllerId: params.controller,
              oracleIrSourceId: sourceId,
              oracleIrSourceName: sourceName,
            }),
      } as any, result, params) as any);
      appendQueuedResolutionPromptEvent(ctx, {
        playerId: built.playerId,
        sourceId,
        queuedResolutionStep: queuedStep,
      });
      continue;
    }

    if (step.kind === 'look_select_top') {
      const built = buildLookSelectTopSelectionOptions(state, step, params.irCtx);
      if (!built || built.lookedCount === 0) continue;

      const queueKey = `look_select:${String((step as any).raw || '')}:${built.playerId}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      const isLibraryTop = built.destination === 'library_top';
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: built.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Look and select')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        searchCriteria: String((step as any).raw || 'Look at the top cards of your library'),
        minSelections: built.chooseMin,
        maxSelections: built.chooseCount,
        destination: isLibraryTop ? 'top' : built.destination === 'graveyard' ? 'graveyard' : 'hand',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: built.restDestination === 'graveyard' ? 'graveyard' : 'bottom',
        remainderRandomOrder: built.restRandomOrder,
        availableCards: built.availableCards.map(normalizeTopLibraryPromptCard),
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
    }
  }
}

function queueSearchLibraryChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    sourceItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'search_library') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'search_library') continue;

    const stepRaw = String((step as any).raw || 'Search your library');

    const built = buildSearchLibrarySelectionOptions(
      state,
      step as Extract<OracleEffectStep, { kind: 'search_library' }>,
      params.irCtx,
    );
    if (!built || built.matches.length === 0) continue;

    const queueKey = `search_library:${String((step as any).raw || '')}:${built.playerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const tutorInfo = detectTutorSpell(stepRaw);
    const splitDestination = tutorInfo.splitDestination === true;
    const destination = splitDestination
      ? 'split'
      : built.destination === 'battlefield'
        ? 'battlefield'
        : built.destination === 'graveyard'
          ? 'graveyard'
          : built.destination === 'exile'
            ? 'exile'
            : built.destination === 'top'
              ? 'top'
              : built.destination === 'bottom'
                ? 'bottom'
                : 'hand';
    const criteriaText = String((step as any).criteria?.text || tutorInfo.searchCriteria || '');
    const filter = parseLibrarySearchFilter(criteriaText);
    const criteriaLower = criteriaText.toLowerCase();
    const totalManaValueCapMatch = criteriaLower.match(/total mana value (\d+) or less/);
    const maxTotalManaValue = totalManaValueCapMatch
      ? Math.max(0, Number(totalManaValueCapMatch[1]) || 0)
      : undefined;
    if (
      typeof filter.maxCmc !== 'number'
      && maxTotalManaValue === undefined
      && /(?:mana value|converted mana cost|cmc)\s+x\s+or\s+less/.test(criteriaLower)
    ) {
      const xValue = Number(params.irCtx.xValue);
      if (Number.isFinite(xValue)) {
        filter.maxCmc = Math.max(0, Math.floor(xValue));
      }
    }

    const sourceItem = params.sourceItem;
    const chosenType = String(
      params.irCtx.selectorContext?.chosenCreatureType
      || (params.irCtx as any).chosenCreatureType
      || sourceItem?.chosenCreatureType
      || sourceItem?.card?.chosenCreatureType
      || '',
    ).trim();
    const beholdPaid = Boolean(
      sourceItem?.additionalCostPaid ?? sourceItem?.card?.additionalCostPaid,
    );
    const chosenTypeBattlefieldIfPaid =
      beholdPaid
      && chosenType
      && (
        isCelestialReunionOracle(stepRaw)
        || /creature card with mana value x or less/i.test(stepRaw)
      )
        ? { chosenType, additionalCostPaid: true as const }
        : undefined;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: built.playerId,
      description: `${sourceName}: ${stepRaw}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      searchCriteria: stepRaw,
      minSelections: built.minSelections,
      maxSelections: built.maxSelections,
      destination,
      reveal: Boolean((step as any).revealFound),
      shuffleAfter: (step as any).shuffle !== false,
      filter,
      availableCards: built.matches.map(normalizeTopLibraryPromptCard),
      persistLibrarySearchResolve: true,
      persistLibrarySearchResolveReason: 'stack_resolution',
      ...(maxTotalManaValue !== undefined ? { maxTotalManaValue } : {}),
      ...(chosenTypeBattlefieldIfPaid ? { chosenTypeBattlefieldIfPaid } : {}),
      ...(splitDestination
        ? {
            splitDestination: true,
            toBattlefield: tutorInfo.toBattlefield ?? 1,
            toHand: tutorInfo.toHand ?? 1,
            entersTapped: tutorInfo.entersTapped === true || Boolean((step as any).entersTapped),
          }
        : ((step as any).entersTapped ? { entersTapped: true } : {})),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function parseChoosePileRevealCount(raw: string): number {
  const match = String(raw || '').match(
    /reveal\s+the\s+top\s+(a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|x)\s+cards?/i,
  );
  if (!match) return 3;
  const token = String(match[1] || '').toLowerCase();
  const words: Record<string, number> = {
    a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  if (words[token] !== undefined) return words[token];
  const parsed = parseInt(token, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3;
}

function listActiveOpponentIds(state: any, controller: PlayerID): PlayerID[] {
  return (state.players || [])
    .filter((player: any) => String(player?.id || '') !== String(controller) && !player?.eliminated)
    .map((player: any) => String(player.id).trim() as PlayerID)
    .filter(Boolean);
}

function revealCardsFromControllerLibrary(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  count: number,
): any[] {
  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  const player = (state.players || []).find((entry: any) => String(entry?.id || '') === String(controller));
  let library = libraries?.get(controller);
  if (!Array.isArray(library)) {
    library = Array.isArray(player?.library)
      ? [...player.library]
      : [...(state.zones?.[controller]?.library || [])];
  } else {
    library = [...library];
  }

  const revealCount = Math.min(Math.max(0, count), library.length);
  const revealed = library.splice(0, revealCount).map((card: any) => ({ ...card, zone: 'revealed' }));

  if (libraries) {
    libraries.set(controller, library);
  }
  if (player) {
    player.library = library.map((card: any) => ({ ...card, zone: 'library' }));
  }

  const zones = state.zones || {};
  const playerZones = { ...(zones[controller] || {}) };
  playerZones.library = library;
  playerZones.libraryCount = library.length;
  state.zones = { ...zones, [controller]: playerZones };

  return revealed;
}

function findNextLastSplitPileStep(steps: readonly OracleEffectStep[] | undefined): OracleEffectStep | undefined {
  if (!Array.isArray(steps)) return undefined;
  return steps.find((step) => step?.kind === 'choose_pile' && (step as any).source === 'last_split_piles');
}

function buildChoosePileSplitMetadata(
  step: OracleEffectStep,
  controller: PlayerID,
  sourceName: string,
  sourceId: string | undefined,
  revealed: readonly any[],
  result: OracleIRExecutionResult,
  params: { controller: PlayerID; sourceName?: string; sourceId?: string },
) {
  const originalOrder = revealed.map((card) => String(card?.id || '')).filter(Boolean);
  const chosenDestination = String((step as any).chosenDestination || 'hand');
  const otherDestination = String((step as any).otherDestination || 'graveyard');
  const nextChoosePileStep = findNextLastSplitPileStep(result.pendingContinuationSteps);
  const choiceStepJson = nextChoosePileStep ? JSON.stringify([nextChoosePileStep]) : undefined;

  return attachOracleIrResumeMetadata({
    items: revealed.map((card) => ({
      id: card.id,
      label: card.name || card.id,
      description: card.type_line,
      imageUrl: card.image_uris?.normal || card.image_uris?.small,
    })),
    minPerPile: 0,
    choosePileFromSplitChoice: true,
    choosePileFromSplitChooserPlayerId: controller,
    choosePileFromSplitSourceName: sourceName,
    choosePileFromSplitItems: revealed.map((card) => ({ ...card })),
    choosePileFromSplitOriginalOrder: originalOrder,
    choosePileFromSplitChosenAction: 'move_cards',
    choosePileFromSplitChosenDestination: chosenDestination,
    choosePileFromSplitOtherDestination: otherDestination,
    choosePileFromSplitMovePlayerId: controller,
    choosePileFromSplitChoiceDescription: `${sourceName}: Choose a pile`,
    choosePileFromSplitSplitMessage: `${sourceName}: The cards were separated into two piles.`,
    ...(choiceStepJson ? {
      oracleIrChoiceStepJson: choiceStepJson,
      oracleIrPlayerChoiceKind: 'choose_pile',
      oracleIrControllerId: controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } : {}),
  } as Record<string, unknown>, result, params);
}

function queueChoosePileChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'choose_pile') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'choose_pile') continue;

    const chooser = String((gap.metadata as any)?.chooser || params.controller).trim() as PlayerID;
    const queueKey = `choose_pile:${String((step as any).source || '')}:${String((step as any).raw || '')}:${chooser}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const stepSource = String((step as any).source || 'last_split_piles');

    if (stepSource === 'top_library') {
      const revealCount = parseChoosePileRevealCount(String((step as any).raw || ''));
      const revealed = revealCardsFromControllerLibrary(ctx, state, params.controller, revealCount);
      if (revealed.length === 0) continue;

      const opponents = listActiveOpponentIds(state, params.controller);
      const splitMetadata = buildChoosePileSplitMetadata(
        step,
        params.controller,
        sourceName,
        sourceId,
        revealed,
        result,
        params,
      );

      if (opponents.length === 0) {
        const zones = state.zones?.[params.controller] || {};
        const hand = Array.isArray(zones.hand) ? [...zones.hand] : [];
        for (const card of revealed) {
          hand.push({ ...card, zone: 'hand' });
        }
        state.zones = {
          ...(state.zones || {}),
          [params.controller]: {
            ...zones,
            hand,
            handCount: hand.length,
          },
        };
        continue;
      }

      if (opponents.length > 1) {
        ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.OPTION_CHOICE,
          playerId: params.controller,
          description: `${sourceName}: Choose an opponent to separate the revealed cards into two piles`,
          mandatory: (step as any).optional !== true,
          sourceId,
          sourceName,
          options: opponents.map((opponentId) => ({ id: opponentId, label: opponentId })),
          minSelections: 1,
          maxSelections: 1,
          choosePlayerForTwoPileSplitChoice: true,
          choosePlayerForTwoPileSplitController: params.controller,
          choosePlayerForTwoPileSplitSourceName: sourceName,
          choosePlayerForTwoPileSplitDescription: `${sourceName}: Separate the revealed cards into two piles`,
          choosePlayerForTwoPileSplitItems: revealed.map((card) => ({
            id: card.id,
            label: card.name || card.id,
            description: card.type_line,
            imageUrl: card.image_uris?.normal || card.image_uris?.small,
          })),
          choosePlayerForTwoPileSplitMinPerPile: 0,
          ...splitMetadata,
        } as any, result, params) as any);
        continue;
      }

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.TWO_PILE_SPLIT,
        playerId: opponents[0],
        description: `${sourceName}: Separate the revealed cards into two piles`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        ...splitMetadata,
      } as any, result, params) as any);
      continue;
    }

    const storedSplit = (state as any).oracleIrLastSplitPiles as {
      pileA?: string[];
      pileB?: string[];
      items?: any[];
      originalOrder?: string[];
      chosenDestination?: string;
      otherDestination?: string;
      movePlayerId?: PlayerID;
    } | undefined;

    const pilePayload = storedSplit?.pileA && storedSplit?.pileB
      ? {
          choosePileFromSplitChoice: true,
          choosePileFromSplitChooserPlayerId: chooser,
          choosePileFromSplitSourceName: sourceName,
          choosePileFromSplitItems: storedSplit.items || [],
          choosePileFromSplitOriginalOrder: storedSplit.originalOrder,
          choosePileFromSplitChosenAction: 'move_cards',
          choosePileFromSplitChosenDestination: storedSplit.chosenDestination
            || String((step as any).chosenDestination || 'hand'),
          choosePileFromSplitOtherDestination: storedSplit.otherDestination
            || String((step as any).otherDestination || 'graveyard'),
          choosePileFromSplitMovePlayerId: storedSplit.movePlayerId || params.controller,
          choosePileFromSplitPileA: storedSplit.pileA,
          choosePileFromSplitPileB: storedSplit.pileB,
        }
      : {};

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: chooser,
      description: `${sourceName}: ${String((step as any).raw || 'Choose a pile')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      options: [
        { id: 'pileA', label: 'Pile A' },
        { id: 'pileB', label: 'Pile B' },
      ],
      minSelections: 1,
      maxSelections: 1,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
      oracleIrPlayerChoiceKind: 'choose_pile',
      ...pilePayload,
    } as any, result, params) as any);
  }
}

function queueChangeTargetChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'change_target') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'change_target') continue;

    const metadata = (gap.metadata || {}) as Record<string, unknown>;
    const phase = String(metadata.changeTargetPhase || 'choose_spell').trim();
    const queueKey = `change_target:${phase}:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    if (phase === 'choose_new_target') {
      const chosenSpellId = String(metadata.chosenSpellId || '').trim();
      const candidateTargetIds = Array.isArray(metadata.candidateTargetIds)
        ? metadata.candidateTargetIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      const validTargets = (state.battlefield || [])
        .filter((perm: any) => candidateTargetIds.length === 0 || candidateTargetIds.includes(String(perm?.id || '')))
        .map((perm: any) => ({
          id: String(perm.id || ''),
          name: String(perm?.card?.name || perm?.name || 'Permanent'),
          type: 'permanent',
        }))
        .filter((target: any) => target.id);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: params.controller,
        description: `${sourceName}: ${String((step as any).raw || 'Choose a new target')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        validTargets,
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        oracleIrChangeTargetPhase: 'choose_new_target',
        oracleIrTargetSpellId: chosenSpellId,
      } as any, result, params) as any);
      continue;
    }

    const candidateSpellIds = Array.isArray(metadata.candidateSpellIds)
      ? metadata.candidateSpellIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const stack = Array.isArray(state.stack) ? state.stack : [];
    const options = candidateSpellIds.map((spellId) => {
      const item = stack.find((entry: any) => String(entry?.id || '') === spellId);
      const name = String(item?.card?.name || item?.name || item?.sourceName || spellId);
      return { id: spellId, label: name };
    }).filter((option) => option.id);

    if (options.length === 0) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description: `${sourceName}: ${String((step as any).raw || 'Choose a spell')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      options,
      minSelections: 1,
      maxSelections: 1,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
      oracleIrChangeTargetPhase: 'choose_spell',
    } as any, result, params) as any);
  }
}

function normalizeOracleIrTopLibraryIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object') {
        return String((entry as { id?: string }).id || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function extractOracleIrTopLibraryOrderingFromResponse(
  stepKind: 'scry' | 'surveil',
  selections: unknown,
): Record<string, unknown> | null {
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
    return null;
  }
  const record = selections as Record<string, unknown>;
  const keepTopOrder = normalizeOracleIrTopLibraryIdList(record.keepTopOrder);
  if (stepKind === 'scry') {
    const bottomOrder = normalizeOracleIrTopLibraryIdList(record.bottomOrder);
    if (keepTopOrder.length + bottomOrder.length === 0) return null;
    return {
      keepTopOrder,
      bottomOrder,
      scryResolutionComplete: true,
    };
  }
  const toGraveyard = normalizeOracleIrTopLibraryIdList(record.toGraveyard);
  if (keepTopOrder.length + toGraveyard.length === 0) return null;
  return {
    keepTopOrder,
    toGraveyard,
    surveilResolutionComplete: true,
  };
}

function extractOracleIrSelectionIds(selections: unknown): string[] {
  if (typeof selections === 'string') {
    const id = selections.trim();
    return id ? [id] : [];
  }
  if (Array.isArray(selections)) {
    return selections
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object') {
          return String((entry as any).id || (entry as any).optionId || (entry as any).value || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (selections && typeof selections === 'object') {
    const record = selections as Record<string, unknown>;
    for (const key of ['selectedIds', 'selectedCardIds', 'selectedTargetIds', 'targets', 'selections']) {
      if (Array.isArray(record[key])) {
        return extractOracleIrSelectionIds(record[key]);
      }
    }
  }
  return [];
}

function buildConniveDiscardPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'connive' }>,
  irCtx: OracleIRExecutionContext,
): { playerId: PlayerID; discardCount: number; hand: any[] } | null {
  const targetId = resolveSingleCreatureTargetId(state, step.target, irCtx);
  if (!targetId) return null;

  const target = (state.battlefield || []).find((perm: any) => String(perm?.id || '').trim() === targetId);
  const playerId = String(target?.controller || irCtx.controllerId || '').trim() as PlayerID;
  if (!playerId) return null;

  const amount = resolveOracleQuantity(
    state,
    irCtx.controllerId,
    step.amount as OracleQuantity,
    irCtx,
    { whereX: (step as any).whereX },
  );
  if (amount === null || amount <= 0) return null;

  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId);
  const hand = Array.isArray(player?.hand) ? player.hand : [];
  if (hand.length <= amount) return null;

  return {
    playerId,
    discardCount: amount,
    hand: hand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || card?.card?.name || card?.id || 'Card'),
      type_line: card?.type_line || card?.card?.type_line,
      oracle_text: card?.oracle_text || card?.card?.oracle_text,
      imageUrl: card?.image_uris?.normal || card?.imageUrl,
      mana_cost: card?.mana_cost || card?.card?.mana_cost,
      cmc: card?.cmc ?? card?.card?.cmc,
    })).filter((card) => card.id),
  };
}

const KEYWORD_COUNTER_FROM_AMONG_PATTERN = /counter from among/i;

function isKeywordCounterFromAmongPlayerChoice(
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
): boolean {
  if (step.choice !== 'generic') return false;
  if (!KEYWORD_COUNTER_FROM_AMONG_PATTERN.test(String(step.raw || ''))) return false;
  const options = Array.isArray(step.options) ? step.options : [];
  return options.length > 0;
}

function resolveKeywordCounterTargetPermanent(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  irCtx: OracleIRExecutionContext,
  triggerItem?: any,
): { id: string; name: string } | null {
  const targetId = String(
    resolveSingleCreatureTargetId(state, step.target, irCtx)
    || triggerItem?.targets?.[0]?.id
    || triggerItem?.targets?.[0]
    || irCtx.targetPermanentId
    || irCtx.targetCreatureId
    || '',
  ).trim();
  if (!targetId) return null;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const targetPermanent = battlefield.find((perm: any) => String(perm?.id || '') === targetId);
  if (!targetPermanent) return null;

  return {
    id: targetId,
    name: String(targetPermanent?.card?.name || targetPermanent?.name || 'the creature').trim() || 'the creature',
  };
}

function precedingPlusOneCounterAlreadyApplied(result: OracleIRExecutionResult): boolean {
  return (result.appliedSteps || []).some((applied) =>
    applied.kind === 'add_counter'
    && String((applied as any).counter || '') === '+1/+1',
  );
}

function buildKeywordCounterFromAmongModalPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  irCtx: OracleIRExecutionContext,
  params: {
    controller: PlayerID;
    sourceName: string;
    sourceId?: string;
    triggerItem?: any;
    result: OracleIRExecutionResult;
  },
): Record<string, unknown> | null {
  if (!isKeywordCounterFromAmongPlayerChoice(step)) return null;

  const target = resolveKeywordCounterTargetPermanent(state, step, irCtx, params.triggerItem);
  if (!target) return null;

  const counterOptions = (Array.isArray(step.options) ? step.options : [])
    .map((opt) => String(opt || '').trim())
    .filter(Boolean);
  if (counterOptions.length === 0) return null;

  const plusOneAlreadyApplied = precedingPlusOneCounterAlreadyApplied(params.result);
  const sourceImage = params.triggerItem?.card?.image_uris?.small
    || params.triggerItem?.card?.image_uris?.normal
    || undefined;

  return {
    type: ResolutionStepType.MODAL_CHOICE,
    playerId: params.controller,
    description: `${params.sourceName}: Choose a counter type to put on ${target.name}`,
    mandatory: step.optional !== true,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    sourceImage,
    promptTitle: 'Choose Counter Type',
    promptDescription: plusOneAlreadyApplied
      ? `Which keyword counter to put on ${target.name}?`
      : `Put a +1/+1 counter and which keyword counter on ${target.name}?`,
    options: counterOptions.map((opt) => ({
      id: opt.toLowerCase().replace(/\s+/g, '_'),
      label: opt.charAt(0).toUpperCase() + opt.slice(1),
    })),
    minSelections: 1,
    maxSelections: 1,
    keywordCounterChoiceData: {
      targetPermanentId: target.id,
      targetName: target.name,
      allowedKeywords: counterOptions,
      ...(plusOneAlreadyApplied ? {} : { extraCounters: { '+1/+1': 1 } }),
      sourceName: params.sourceName,
    },
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
    oracleIrPlayerChoiceKind: step.choice,
    oracleIrTargetPermanentId: target.id,
  };
}

function buildPlayerChoicePrompt(
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  params: { controller: PlayerID; sourceName: string; sourceId?: string },
): Record<string, unknown> | null {
  const description = `${params.sourceName}: ${String(step.raw || 'Make a choice')}`;
  const base = {
    mandatory: step.optional !== true,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
    oracleIrPlayerChoiceKind: step.choice,
  };

  if (step.choice === 'card_type') {
    return {
      ...base,
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      playerId: params.controller,
      description,
    };
  }

  if (step.choice === 'letter') {
    const options = Array.isArray(step.options) && step.options.length > 0
      ? step.options.map((value) => ({ id: String(value), label: String(value) }))
      : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => ({ id: letter, label: letter }));
    return {
      ...base,
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description,
      options,
      minSelections: 1,
      maxSelections: 1,
    };
  }

  if (step.choice === 'odd_even') {
    return {
      ...base,
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description,
      options: [
        { id: 'odd', label: 'Odd' },
        { id: 'even', label: 'Even' },
      ],
      minSelections: 1,
      maxSelections: 1,
    };
  }

  const genericOptions = Array.isArray(step.options)
    ? step.options.map((value) => ({ id: String(value), label: String(value) })).filter((option) => option.id)
    : [];
  if (genericOptions.length === 0) return null;

  return {
    ...base,
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: params.controller,
    description,
    options: genericOptions,
    minSelections: 1,
    maxSelections: 1,
  };
}

function manaSymbolToColorCode(symbol: string): string | null {
  const match = String(symbol || '').trim().match(/^\{?([WUBRG])\}?$/i);
  return match ? match[1]!.toUpperCase() : null;
}

function poolKeyToManaSymbol(poolKey: string): string | null {
  const normalized = String(poolKey || '').trim().toLowerCase();
  const codeByPoolKey: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    colorless: 'C',
  };
  const code = codeByPoolKey[normalized] || (normalized.match(/^[wubrg]$/) ? normalized.toUpperCase() : '');
  return code ? `{${code}}` : null;
}

function buildChosenManaFromDistribution(distribution: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [color, countRaw] of Object.entries(distribution)) {
    const count = Number(countRaw || 0);
    const code = String(color || '').trim().toUpperCase();
    if (!Number.isFinite(count) || count <= 0 || !/^[WUBRG]$/.test(code)) continue;
    for (let index = 0; index < count; index += 1) {
      parts.push(`{${code}}`);
    }
  }
  return parts.join('');
}

function buildAddManaColorSelectionPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  irCtx: OracleIRExecutionContext,
  params: { controller: PlayerID; sourceName: string; sourceId?: string },
): Record<string, unknown> | null {
  let allowedColors = Array.isArray(step.manaOptions)
    ? step.manaOptions.map(manaSymbolToColorCode).filter(Boolean) as string[]
    : [];
  if (allowedColors.length === 0 && step.requiresChosenMana) {
    allowedColors = ['W', 'U', 'B', 'R', 'G'];
  }
  if (allowedColors.length <= 1) {
    return null;
  }

  const playerIds = [...resolvePlayers(state, step.who, irCtx)];
  const playerId = playerIds[0] || params.controller;
  if (!playerId) return null;

  const rawText = String(step.raw || '').trim();
  const amount = resolveOracleQuantity(state, params.controller, step.amount as OracleQuantity, irCtx)
    ?? (step.amount?.kind === 'number' ? Math.max(0, Math.floor(step.amount.value)) : 1)
    ?? 1;
  const requiresCombinationChoice = /any combination of/i.test(rawText) && amount > 1;
  const requiresRepeatedSingleChoice = /any one color/i.test(rawText) && amount > 1;

  const base = {
    type: ResolutionStepType.MANA_COLOR_SELECTION,
    playerId,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    description: `${params.sourceName}: ${rawText || 'Choose a color'}`,
    mandatory: step.optional !== true,
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
    cardName: params.sourceName,
  };

  if (requiresCombinationChoice || requiresRepeatedSingleChoice) {
    return {
      ...base,
      selectionKind: 'distribution',
      totalAmount: amount,
      availableColors: allowedColors,
      allowedColors,
      amount,
    };
  }

  return {
    ...base,
    selectionKind: 'any_color',
    amount: Math.max(1, amount),
    allowedColors,
  };
}

function queueAddManaChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'add_mana') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'add_mana') continue;

    const prompt = buildAddManaColorSelectionPrompt(
      state,
      step as Extract<OracleEffectStep, { kind: 'add_mana' }>,
      params.irCtx,
      { controller: params.controller, sourceName, sourceId },
    );
    if (!prompt) continue;

    const queueKey = `add_mana:${String((step as any).raw || '')}:${String(prompt.playerId || params.controller)}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata(prompt, result, params) as any);
  }
}

const DISTRIBUTE_TARGET_WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function parseAddCounterDistributeTargetBounds(targetText: string): { minTargets: number; maxTargets: number } {
  const normalized = String(targetText || '').trim().toLowerCase();
  const upToMatch = normalized.match(/\bup to (one|two|three|four|five|\d+)\b/i);
  if (upToMatch) {
    const token = String(upToMatch[1] || '').toLowerCase();
    const maxTargets = DISTRIBUTE_TARGET_WORD_TO_NUMBER[token] ?? Number.parseInt(token, 10);
    return {
      minTargets: 0,
      maxTargets: Number.isFinite(maxTargets) && maxTargets > 0 ? maxTargets : 1,
    };
  }

  const orListMatch = normalized.match(/\b(one|two|three|four|five|\d+)(?:,\s*(?:one|two|three|four|five|\d+))+\b/i);
  if (orListMatch) {
    const tokens = normalized.match(/\b(one|two|three|four|five|\d+)\b/gi) || [];
    const values = tokens
      .map((token) => DISTRIBUTE_TARGET_WORD_TO_NUMBER[String(token || '').toLowerCase()] ?? Number.parseInt(String(token || ''), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length > 0) {
      const maxTargets = Math.max(...values);
      return { minTargets: 0, maxTargets };
    }
  }

  return { minTargets: 1, maxTargets: 1 };
}

function buildAddCounterDistributeTargetSelectionOptions(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  controller: PlayerID,
): {
  options: Array<{ id: string; label: string; type: string }>;
  minTargets: number;
  maxTargets: number;
} | null {
  const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
  if (!targetText) return null;

  const { minTargets, maxTargets } = parseAddCounterDistributeTargetBounds(targetText);
  const requiredType = parseSimplePermanentTypeFromText(targetText) || 'creature';
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  let controllerFilter: 'you' | 'opponent' | 'any' = 'any';
  if (/\byou control\b/i.test(targetText)) controllerFilter = 'you';
  if (/\b(?:an opponent|opponents?)\s+controls?\b/i.test(targetText)) controllerFilter = 'opponent';

  const options = battlefield
    .filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      const permController = String(perm?.controller || '').trim();
      if (controllerFilter === 'you' && permController !== String(controller)) return false;
      if (controllerFilter === 'opponent' && permController === String(controller)) return false;
      if (requiredType === 'nonland_permanent') {
        return hasExecutorClass(perm, 'creature')
          || hasExecutorClass(perm, 'artifact')
          || hasExecutorClass(perm, 'enchantment')
          || hasExecutorClass(perm, 'planeswalker')
          || hasExecutorClass(perm, 'battle');
      }
      return hasExecutorClass(perm, requiredType as any);
    })
    .map((perm: any) => ({
      id: String(perm.id || ''),
      label: String(perm?.card?.name || perm?.name || 'Permanent').trim() || String(perm.id || ''),
      type: 'permanent',
    }))
    .filter((option) => option.id);

  if (options.length === 0) return null;

  return {
    options,
    minTargets: Math.min(minTargets, options.length),
    maxTargets: Math.min(maxTargets, options.length),
  };
}

function queueAddCounterTargetSelectionPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'add_counter') continue;
    if (gap.reasonCode !== 'no_deterministic_target') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'add_counter') continue;

    const isDistributeAmong =
      (step as any).distribution === 'among'
      || /^distribute\b/i.test(String((step as any).raw || ''));
    if (!isDistributeAmong) continue;

    const built = buildAddCounterDistributeTargetSelectionOptions(
      state,
      step as Extract<OracleEffectStep, { kind: 'add_counter' }>,
      params.controller,
    );
    if (!built || built.options.length === 0) continue;

    const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
    const queueKey = `add_counter_target:${String((step as any).raw || '')}:${targetText}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: params.controller,
      description: `${sourceName}: ${String((step as any).raw || 'Choose targets')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      validTargets: built.options,
      targetTypes: ['creature'],
      minTargets: built.minTargets,
      maxTargets: built.maxTargets,
      targetDescription: String((step.target as any)?.text || (step.target as any)?.raw || 'target creatures'),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function buildCounterDistributionPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  gap: { readonly metadata?: Record<string, string | number | boolean | null | readonly string[]> },
  params: { controller: PlayerID; sourceName: string; sourceId?: string },
): Record<string, unknown> | null {
  const metadata = gap.metadata || {};
  const targetIds = Array.isArray(metadata.distributionTargetIds)
    ? metadata.distributionTargetIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const totalAmount = Number(metadata.distributionTotalAmount ?? 0);
  const counterType = String(metadata.distributionCounterName || step.counter || '+1/+1').trim();
  if (targetIds.length <= 1 || totalAmount <= targetIds.length || !counterType) {
    return null;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const validTargets = targetIds.map((targetId) => {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '').trim() === targetId);
    const name = String(permanent?.card?.name || permanent?.name || targetId).trim() || targetId;
    return {
      id: targetId,
      label: name,
      type: 'permanent',
    };
  });

  return {
    type: ResolutionStepType.COUNTER_DISTRIBUTION,
    playerId: params.controller,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    description: `${params.sourceName}: ${String(step.raw || 'Distribute counters among targets')}`,
    mandatory: step.optional !== true,
    counterType,
    totalAmount,
    minPerTarget: Math.max(1, Number(metadata.distributionMinPerTarget ?? 1)),
    validTargets,
    message: `Distribute ${totalAmount} ${counterType} counter(s). Each target must receive at least 1.`,
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
  };
}

function queueCounterDistributionPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'add_counter') continue;
    if (!Array.isArray(gap.metadata?.distributionTargetIds)) continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'add_counter') continue;

    const prompt = buildCounterDistributionPrompt(
      state,
      step as Extract<OracleEffectStep, { kind: 'add_counter' }>,
      gap,
      { controller: params.controller, sourceName, sourceId },
    );
    if (!prompt) continue;

    const queueKey = `counter_distribution:${String((step as any).raw || '')}:${targetIdsKey(gap.metadata?.distributionTargetIds)}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata(prompt, result, params) as any);
  }
}

function targetIdsKey(value: string | number | boolean | null | readonly string[] | undefined): string {
  if (!Array.isArray(value)) return '';
  return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(',');
}

function queueConniveChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'connive') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'connive') continue;

    const built = buildConniveDiscardPrompt(state, step as Extract<OracleEffectStep, { kind: 'connive' }>, params.irCtx);
    if (!built || built.hand.length <= built.discardCount) continue;

    const targetId = resolveSingleCreatureTargetId(state, (step as any).target, params.irCtx) || undefined;
    const queueKey = `connive:${String((step as any).raw || '')}:${built.playerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: built.playerId,
      description: `${sourceName}: ${String((step as any).raw || 'Connive')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      hand: built.hand,
      discardCount: built.discardCount,
      minDiscardCount: built.discardCount,
      maxDiscardCount: built.discardCount,
      currentHandSize: built.hand.length,
      reason: 'connive',
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrTargetPermanentId: targetId,
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function queuePlayerChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'player_choice') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'player_choice' }> | undefined;
    if (!step || step.kind !== 'player_choice') continue;

    const queueKey = `player_choice:${String((step as any).choice || '')}:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const irCtxForChoice = {
      ...params.irCtx,
      stepLedger: params.irCtx.stepLedger?.size
        ? params.irCtx.stepLedger
        : readStepLedgerFromState(state),
      appliedStepKinds: params.irCtx.appliedStepKinds?.size
        ? params.irCtx.appliedStepKinds
        : readAppliedStepKindsFromState(state),
    };
    const amongBuilt = buildPlayerChoiceAmongThemSelectionOptions(state, step, irCtxForChoice);
    if (amongBuilt) {
      const availableCards = amongBuilt.availableCards.map(normalizeTopLibraryPromptCard);
      const selectableIds = new Set(amongBuilt.selectableCardIds);
      const nonSelectableCards = availableCards.filter(
        (card) => !selectableIds.has(String(card.id || '')),
      );
      const remainderRandomOrder = /\brandom order\b/i.test(String((step as any).raw || ''))
        || (result.pendingContinuationSteps || []).some((pending) =>
          /\brandom order\b/i.test(String((pending as any).raw || '')),
        );
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: amongBuilt.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Choose cards')}`,
        mandatory: step.optional !== true,
        sourceId,
        sourceName,
        searchCriteria: String((step as any).raw || 'Choose cards from among them'),
        minSelections: amongBuilt.minSelections,
        maxSelections: amongBuilt.maxSelections,
        destination: 'hand',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder,
        availableCards,
        nonSelectableCards,
        filter: amongBuilt.filter,
        persistLibrarySearchResolve: true,
        persistLibrarySearchResolveReason: 'stack_resolution',
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, { ...params, controller: params.controller }) as any);
      continue;
    }

    const keywordCounterPrompt = buildKeywordCounterFromAmongModalPrompt(
      state,
      step,
      irCtxForChoice,
      {
        controller: params.controller,
        sourceName,
        sourceId,
        triggerItem: params.triggerItem,
        result,
      },
    );
    if (keywordCounterPrompt) {
      ResolutionQueueManager.addStep(
        gameId,
        attachOracleIrResumeMetadata(keywordCounterPrompt, result, params) as any,
      );
      continue;
    }

    const prompt = buildPlayerChoicePrompt(
      step,
      { controller: params.controller, sourceName, sourceId },
    );
    if (!prompt) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata(prompt, result, params) as any);
  }
}

function syncIrPendingDiscardFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  const sourceName = String(params.sourceName || 'Spell').trim() || 'Spell';

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'discard') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'discard' }> | undefined;
    if (!step) continue;

    const builtPrompts = collectDiscardSelectionOptionsForStep(state, step, params.irCtx);
    for (const built of builtPrompts) {
      if (!built) continue;
      if (!built.anyNumberDiscard && built.discardCount <= 0) continue;

      if (gameId && gameId !== 'unknown') {
        try {
          const alreadyQueued = ResolutionQueueManager
            .getStepsForPlayer(gameId, built.playerId)
            .some((candidate) => candidate.type === ResolutionStepType.DISCARD_SELECTION);
          if (alreadyQueued) continue;
        } catch {
          // ignore
        }
      }

      state.pendingDiscard = state.pendingDiscard || {};
      state.pendingDiscard[built.playerId] = {
        count: built.discardCount,
        source: sourceName,
        reason: 'spell_effect',
      };
    }
  }
}

function findSkippedOracleStep(
  result: OracleIRExecutionResult,
  gap: { readonly stepKind?: string; readonly raw?: string }
): OracleEffectStep | undefined {
  return (result.skippedSteps || []).find(
    (candidate) =>
      String(candidate.kind || '') === String(gap.stepKind || '') &&
      String((candidate as any).raw || '') === String(gap.raw || '')
  ) as OracleEffectStep | undefined;
}

function isOracleIrPlayerChoiceGap(gap: { reasonCode?: string }): boolean {
  const reason = String(gap.reasonCode || '');
  return reason === 'player_choice_required' || reason === 'optional_step_requires_player_choice';
}

function buildVoteBallotChoices(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'vote' }>,
  /**
   * Player currently casting the ballot. For "another player" / "each other player"
   * filters this must be the **voter**, not the spell controller.
   */
  voterId: PlayerID,
): string[] {
  const ballot = String((step as any).ballot || 'labels');
  if (ballot === 'players') {
    const players = Array.isArray(state?.players) ? state.players : [];
    const filter = String((step as any).ballotFilter || '').toLowerCase();
    return players
      .map((p: any) => String(p?.id || '').trim())
      .filter((id: string) => {
        if (!id) return false;
        if (/\banother\s+player\b|\beach\s+other\s+player\b/i.test(filter) && id === voterId) {
          return false;
        }
        return true;
      });
  }
  if (ballot === 'permanents') {
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const filter = String((step as any).ballotFilter || '').toLowerCase();
    return battlefield
      .filter((perm: any) => {
        if (!perm?.id) return false;
        const typeLine = String(perm?.card?.type_line || perm?.type_line || '').toLowerCase();
        if (/\bcreature\b/.test(filter) && !typeLine.includes('creature')) return false;
        if (/\bnonland\s+permanent\b/.test(filter) && typeLine.includes('land')) return false;
        if (/\byou don't control\b|\byou do not control\b/.test(filter) && String(perm.controller || '') === voterId) {
          return false;
        }
        return true;
      })
      .map((perm: any) => String(perm.id));
  }
  return (Array.isArray((step as any).choices) ? (step as any).choices : [])
    .map((choice: unknown) => String(choice || '').trim())
    .filter(Boolean);
}

function buildApnapVoterOrder(
  state: any,
  startingWith: string | undefined,
  controller: PlayerID,
): string[] {
  const players = Array.isArray(state?.players)
    ? state.players.map((p: any) => String(p?.id || '').trim()).filter(Boolean)
    : [];
  if (players.length === 0) return [controller];
  const start =
    String(startingWith || '').trim() ||
    String(state?.activePlayer || state?.turnPlayer || controller).trim() ||
    controller;
  const startIdx = Math.max(0, players.indexOf(start));
  return [...players.slice(startIdx), ...players.slice(0, startIdx)];
}

function queueVotePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'vote') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'vote' }> | undefined;
    if (!step || step.kind !== 'vote') continue;

    const queueKey = `vote:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const voters = resolvePlayers(state, (step as any).voters, params.irCtx);
    const startingWithPlayers = (step as any).startingWith
      ? resolvePlayers(state, (step as any).startingWith, params.irCtx)
      : [];
    const voterOrder = buildApnapVoterOrder(
      state,
      startingWithPlayers[0] || params.controller,
      params.controller,
    ).filter((id) => voters.length === 0 || voters.includes(id));
    if (voterOrder.length === 0) continue;

    const firstVoter = voterOrder[0]!;
    // Ballot choices are voter-relative (e.g. "another player" excludes the voter).
    const firstVoterChoices = buildVoteBallotChoices(state, step, firstVoter as PlayerID);
    if (firstVoterChoices.length < 1) continue;

    const voteId = `vote_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const resumeSteps = [
      step,
      ...((result.pendingContinuationSteps || []) as OracleEffectStep[]),
    ];

    const payload = attachOracleIrResumeMetadata(
      {
        type: ResolutionStepType.VOTE,
        playerId: firstVoter,
        description: `${sourceName}: ${String((step as any).raw || 'Vote')}`,
        mandatory: true,
        sourceId,
        sourceName,
        voteId,
        choices: firstVoterChoices,
        votesSubmitted: [],
        secret: Boolean((step as any).secret),
        oracleIrVoterOrder: voterOrder,
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any,
      result,
      { ...params, controller: params.controller },
    );
    // Resume must re-run the vote step itself with tallies, then continuations.
    payload.oracleIrResumeStepsJson = JSON.stringify(resumeSteps);
    ResolutionQueueManager.addStep(gameId, payload as any);
  }
}

function inferTapUntapTargetFilter(
  targetText: string,
  controller: PlayerID,
): {
  types: string[];
  controller: 'you' | 'opponent' | 'any';
  targetCount: number;
} {
  const lower = String(targetText || '').trim().toLowerCase();
  const upToMatch = lower.match(/^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+)$/i);
  const targetCount = upToMatch
    ? Math.max(1, Number.parseInt(String(upToMatch[1] || '1'), 10) || ({
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    } as Record<string, number>)[String(upToMatch[1] || '').toLowerCase()] || 1)
    : 1;
  const typePhrase = upToMatch ? String(upToMatch[2] || '').trim() : lower;
  const requiredType = parseSimplePermanentTypeFromText(typePhrase) || 'creature';
  const types = requiredType === 'nonland_permanent'
    ? ['nonland_permanent']
    : [requiredType];
  let controllerFilter: 'you' | 'opponent' | 'any' = 'any';
  if (/\byou control\b/i.test(typePhrase)) controllerFilter = 'you';
  if (/\b(?:an opponent|opponents?)\s+controls?\b/i.test(typePhrase)) controllerFilter = 'opponent';
  if (/\btarget player controls\b/i.test(typePhrase)) controllerFilter = 'opponent';
  void controller;
  return { types, controller: controllerFilter, targetCount };
}

function resolveTapMatchingTargetCount(
  amount: OracleQuantity,
  irCtx?: OracleIRExecutionContext,
  state?: any,
  controllerId?: PlayerID,
): number {
  if (amount.kind === 'number') {
    return Math.max(1, Number(amount.value) || 1);
  }
  if (amount.kind === 'x') {
    const xValue = Number(irCtx?.xValue);
    return Number.isFinite(xValue) && xValue > 0 ? Math.max(1, Math.floor(xValue)) : 1;
  }
  if (state && controllerId && irCtx) {
    const resolved = resolveOracleQuantity(state, controllerId, amount, irCtx);
    if (resolved !== null && Number.isFinite(resolved)) return Math.max(1, Math.floor(resolved));
  }
  return 1;
}

function inferTapMatchingPermanentFilter(
  filterText: string,
  controller: PlayerID,
): {
  types: string[];
  requireAllTypes: boolean;
  controller: 'you' | 'opponent' | 'any';
  tapStatus: 'tapped' | 'untapped' | 'any';
} {
  const lower = String(filterText || '').trim().toLowerCase();
  let controllerFilter: 'you' | 'opponent' | 'any' = 'any';
  if (/\byou control\b/i.test(lower)) controllerFilter = 'you';
  void controller;

  let types: string[] = [];
  const requireAllTypes = false;
  if (/\bartifacts?\s+and\/or\s+creatures?\b/i.test(lower)) {
    types = ['artifact', 'creature'];
  } else {
    const simpleType = parseSimplePermanentTypeFromText(lower);
    if (simpleType === 'nonland_permanent') {
      types = ['nonland_permanent'];
    } else if (simpleType) {
      types = [simpleType];
    } else {
      types = ['creature'];
    }
  }

  const tapStatus: 'tapped' | 'untapped' | 'any' = /\buntapped\b/i.test(lower) ? 'untapped' : 'any';
  return { types, requireAllTypes, controller: controllerFilter, tapStatus };
}

function queueTapMatchingPermanentsChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'tap_matching_permanents') continue;
    if (
      gap.reasonCode !== 'player_choice_required'
      && gap.reasonCode !== 'no_deterministic_target'
    ) {
      continue;
    }

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'tap_matching_permanents' }> | undefined;
    if (!step || step.kind !== 'tap_matching_permanents') continue;

    const choosingPlayerId =
      resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;

    const targetCount = resolveTapMatchingTargetCount(step.amount, params.irCtx, state, choosingPlayerId);
    if (targetCount <= 1 && gap.reasonCode !== 'no_deterministic_target') continue;

    const queueKey = `tap_matching:${choosingPlayerId}:${String(step.filter || '')}:${String(step.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const { types, requireAllTypes, controller: controllerFilter, tapStatus } = inferTapMatchingPermanentFilter(
      String(step.filter || ''),
      choosingPlayerId,
    );
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const candidates = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      const permController = String(perm?.controller || '').trim();
      if (controllerFilter === 'you' && permController !== String(choosingPlayerId)) return false;
      if (controllerFilter === 'opponent' && permController === String(choosingPlayerId)) return false;
      if (tapStatus === 'untapped' && perm?.tapped) return false;
      if (tapStatus === 'tapped' && !perm?.tapped) return false;
      if (types.length === 0) return true;
      const typeLine = String(perm?.card?.type_line || '').toLowerCase();
      if (types.includes('nonland_permanent')) {
        return hasExecutorClass(perm, 'creature')
          || hasExecutorClass(perm, 'artifact')
          || hasExecutorClass(perm, 'enchantment')
          || hasExecutorClass(perm, 'planeswalker')
          || hasExecutorClass(perm, 'battle');
      }
      return types.some((requiredType) => typeLine.includes(String(requiredType).toLowerCase()));
    });
    if (candidates.length < targetCount) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      playerId: choosingPlayerId,
      description: `${sourceName}: ${String(step.raw || 'Tap matching permanents').trim()}`,
      mandatory: true,
      sourceId,
      sourceName,
      action: 'tap',
      targetFilter: {
        types,
        requireAllTypes,
        controller: controllerFilter,
        tapStatus,
        excludeSource: false,
      },
      targetCount,
      title: sourceName,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: choosingPlayerId,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function findExiledCardDisplayInfo(
  state: any,
  cardId: string,
): { id: string; name: string; imageUrl?: string } | null {
  const wanted = String(cardId || '').trim();
  if (!wanted) return null;
  for (const player of (Array.isArray(state?.players) ? state.players : []) as any[]) {
    const exile = Array.isArray(player?.exile) ? player.exile : [];
    const card = exile.find((entry: any) => String(entry?.id || '').trim() === wanted);
    if (card) {
      return {
        id: wanted,
        name: String(card?.name || 'Unknown card').trim() || 'Unknown card',
        imageUrl: typeof card?.imageUrl === 'string' ? card.imageUrl : undefined,
      };
    }
  }
  return null;
}

/**
 * Bridges a `repeated_zone_draft` player-choice gap (Thieves' Auction style) to a
 * queued resolution step. Only queues the initial prompt for the first chooser;
 * persists the full remaining pool + chooser order/index on the step so the
 * resolution handler can advance the rotation and re-queue for the next chooser
 * after each pick.
 */
function queueRepeatedZoneDraftChoicePromptFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'repeated_zone_draft') continue;
    if (gap.reasonCode !== 'player_choice_required') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'repeated_zone_draft' }> | undefined;
    if (!step || step.kind !== 'repeated_zone_draft') continue;

    const queueKey = `repeated_zone_draft:${String(step.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const remainingCardIds = Array.isArray(gap.metadata?.remainingCardIds)
      ? (gap.metadata!.remainingCardIds as readonly unknown[]).map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (remainingCardIds.length === 0) continue;

    const chooserOrder = Array.isArray(gap.metadata?.chooserOrder)
      ? (gap.metadata!.chooserOrder as readonly unknown[]).map((id) => String(id || '').trim()).filter(Boolean)
      : [String(params.controller)];
    const entersTapped = gap.metadata?.entersTapped === true;
    const destination = String(gap.metadata?.destination || 'battlefield');
    const firstChooser = (chooserOrder[0] || String(params.controller)) as PlayerID;

    const cards = remainingCardIds
      .map((cardId) => findExiledCardDisplayInfo(state, cardId))
      .filter(Boolean) as { id: string; name: string; imageUrl?: string }[];

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.REPEATED_ZONE_DRAFT,
      playerId: firstChooser,
      description: `${sourceName}: ${String(step.raw || 'Choose a card from the exiled pool').trim()}`,
      mandatory: true,
      sourceId,
      sourceName,
      remainingCardIds,
      cards,
      chooserOrder,
      chooserIndex: 0,
      entersTapped,
      destination,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

/**
 * Bridge a generic per-player N-pile partition to the existing pile-split
 * resolution UI. The response handler advances through playerOrder, carrying
 * prior assignments on the next persisted prompt.
 */
function queueSeparateIntoPilesPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'separate_into_piles') continue;
    if (gap.reasonCode !== 'player_choice_required') continue;

    const step = findSkippedOracleStep(result, gap) as
      | Extract<OracleEffectStep, { kind: 'separate_into_piles' }>
      | undefined;
    if (!step) continue;

    const playerOrder = (Array.isArray(gap.metadata?.playerOrder)
      ? gap.metadata!.playerOrder
      : [params.controller])
      .map((id: unknown) => String(id || '').trim())
      .filter(Boolean);
    const firstPlayerId = String(playerOrder[0] || params.controller).trim() as PlayerID;
    if (!firstPlayerId) continue;

    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const controlled = battlefield.filter(
      (perm: any) => String(perm?.controller || '').trim() === firstPlayerId,
    );
    const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
    const sourceId = String(params.sourceId || '').trim() || undefined;
    const pileCount = Math.max(2, Number(gap.metadata?.pileCount ?? step.pileCount) || 2);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TWO_PILE_SPLIT,
      playerId: firstPlayerId,
      description: `${sourceName}: Separate all permanents you control into ${pileCount} piles`,
      mandatory: true,
      sourceId,
      sourceName,
      items: controlled.map((perm: any) => ({
        id: String(perm?.id || ''),
        label: String(perm?.card?.name || perm?.name || perm?.id || 'Permanent'),
        description: String(perm?.card?.type_line || perm?.type_line || ''),
        imageUrl: perm?.card?.image_uris?.normal
          || perm?.card?.image_uris?.small
          || perm?.card?.imageUrl,
      })),
      minPerPile: step.allowEmptyPiles === true ? 0 : 1,
      pileCount,
      allowEmptyPiles: step.allowEmptyPiles === true,
      oracleIrSequentialPileSplit: true,
      oracleIrPileSplitPlayerOrder: playerOrder,
      oracleIrPileSplitPlayerIndex: 0,
      oracleIrPileAssignmentsByPlayer: {},
      oracleIrPileRandomAction: step.randomPileAction,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function bridgeLibraryChaosExchangeFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    sourceItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'library_chaos_exchange') continue;
    const step = findSkippedOracleStep(result, gap) as LibraryChaosExchangeStep | undefined;
    if (!step) continue;

    const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
    const sourceId = String(params.sourceId || '').trim() || undefined;
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '');
    const preselectedIds = [
      ...((params.irCtx.selectorContext as any)?.chosenObjectIds || []),
      ...(params.irCtx.chosenObjectIds || []),
      ...((params.irCtx as any).targetIds || []),
      ...(Array.isArray(params.sourceItem?.targets) ? params.sourceItem.targets : []),
    ].map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim()).filter(Boolean);
    const hadCastTimeTargets = preselectedIds.length > 0;

    if (step.targetMode === 'single_target') {
      const targetId = preselectedIds.find((id: string) =>
        battlefield.some((permanent: any) =>
          String(permanent?.id || '') === id
          && permanentMatchesLibraryChaosTarget(permanent, targetText),
        ),
      );
      if (!targetId) continue;
      const execution = executeLibraryChaosExchange(ctx, step, [targetId], { sourceId, sourceName });
      queueLibraryChaosCastOffers(ctx, execution.castOffers, { sourceId, sourceName });
      continue;
    }

    if (hadCastTimeTargets) {
      const legalTargetIds = Array.from(new Set(preselectedIds)).filter((id: string) =>
        battlefield.some((permanent: any) =>
          String(permanent?.id || '') === id
          && permanentMatchesLibraryChaosTarget(permanent, targetText),
        ),
      );
      const execution = executeLibraryChaosExchange(ctx, step, legalTargetIds, { sourceId, sourceName });
      queueLibraryChaosCastOffers(ctx, execution.castOffers, { sourceId, sourceName });
      continue;
    }

    const activeIds = new Set(
      (state.players || [])
        .filter((player: any) => player?.inactive !== true && player?.spectator !== true)
        .map((player: any) => String(player?.id || '').trim())
        .filter(Boolean),
    );
    const turnOrder = (Array.isArray(state.turnOrder) && state.turnOrder.length > 0
      ? state.turnOrder
      : (state.players || []).map((player: any) => player?.id))
      .map((id: unknown) => String(id || '').trim())
      .filter((id: string) => id && activeIds.has(id));
    const targetControllers = turnOrder.filter((playerId: string) =>
      battlefield.some((permanent: any) =>
        String(permanent?.controller || '') === playerId
        && permanentMatchesLibraryChaosTarget(permanent, targetText),
      ),
    );
    if (targetControllers.length === 0) continue;

    const firstController = targetControllers[0];
    const validTargets = battlefield
      .filter((permanent: any) =>
        String(permanent?.controller || '') === firstController
        && permanentMatchesLibraryChaosTarget(permanent, targetText),
      )
      .map((permanent: any) => ({
        id: String(permanent?.id || ''),
        label: String(permanent?.card?.name || permanent?.id || 'Permanent'),
        description: String(permanent?.card?.type_line || 'permanent'),
        imageUrl: permanent?.card?.image_uris?.normal || permanent?.card?.image_uris?.small,
        controller: firstController,
      }));

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: params.controller,
      description: `${sourceName}: Choose a ${targetText} controlled by ${firstController}`,
      mandatory: true,
      sourceId,
      sourceName,
      validTargets,
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: targetText,
      oracleIrLibraryChaosTargetSelection: true,
      oracleIrLibraryChaosStepJson: JSON.stringify(step),
      oracleIrLibraryChaosTargetControllers: targetControllers,
      oracleIrLibraryChaosTargetIndex: 0,
      oracleIrLibraryChaosSelectedIds: [],
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any);
  }
}

function queueTapOrUntapChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'tap_or_untap') continue;
    if (
      gap.reasonCode !== 'no_deterministic_target'
      && !isOracleIrPlayerChoiceGap(gap)
    ) {
      continue;
    }

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'tap_or_untap' }> | undefined;
    if (!step || step.kind !== 'tap_or_untap') continue;

    const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
    if (!targetText) continue;

    const queueKey = `tap_or_untap:${targetText}:${String(step.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const { types, controller: controllerFilter, targetCount } = inferTapUntapTargetFilter(
      targetText,
      params.controller,
    );
    const action = step.mode === 'untap' ? 'untap' : 'tap';
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const candidates = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      const permController = String(perm?.controller || '').trim();
      if (controllerFilter === 'you' && permController !== String(params.controller)) return false;
      if (controllerFilter === 'opponent' && permController === String(params.controller)) return false;
      const requiredType = types[0] || 'creature';
      if (requiredType === 'nonland_permanent') {
        return hasExecutorClass(perm, 'creature') || hasExecutorClass(perm, 'artifact') || hasExecutorClass(perm, 'enchantment') || hasExecutorClass(perm, 'planeswalker') || hasExecutorClass(perm, 'battle');
      }
      return hasExecutorClass(perm, requiredType as any);
    });
    if (candidates.length === 0) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      playerId: params.controller,
      description: `${sourceName}: ${String(step.raw || targetText).trim()}`,
      mandatory: true,
      sourceId,
      sourceName,
      action,
      targetFilter: {
        types,
        controller: controllerFilter,
        tapStatus: 'any',
        excludeSource: false,
      },
      targetCount,
      title: sourceName,
    } as any, result, params) as any);
  }
}

function queueCopyPermanentChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  _state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourcePermanentId = String(params.sourceId || '').trim();
  if (!sourcePermanentId) return;

  const queuedKeys = new Set<string>();
  const candidates: OracleEffectStep[] = [];
  for (const step of result.skippedSteps || []) {
    if (step.kind === 'copy_permanent') candidates.push(step);
  }
  for (const step of result.pendingOptionalSteps || []) {
    if (step.kind === 'copy_permanent') candidates.push(step);
  }

  for (const step of candidates) {
    if (step.kind !== 'copy_permanent') continue;
    const copyStep = step as Extract<OracleEffectStep, { kind: 'copy_permanent' }>;
    if (!copyPermanentTriggerStepNeedsTargetSelectionQueue(copyStep)) continue;

    const queueKey = `copy_permanent:${String(copyStep.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    applyCopyPermanentTriggerStep(
      ctx,
      params.controller,
      sourceName,
      copyStep,
      {
        source: sourcePermanentId,
        permanentId: sourcePermanentId,
        sourceId: sourcePermanentId,
      },
    );
  }
}

function buildMoveZoneLibrarySearchPrompt(
  step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  built: NonNullable<ReturnType<typeof buildMoveZoneSelectionOptions>>,
  params: {
    controller: PlayerID;
    sourceName: string;
    sourceId?: string;
  },
): Record<string, unknown> {
  const availableCards = built.availableCards.map(normalizeTopLibraryPromptCard);
  const selectableIds = new Set(built.selectableCardIds);
  const nonSelectableCards = availableCards.filter(
    (card) => !selectableIds.has(String(card.id || '')),
  );

  return {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: built.playerId,
    description: `${params.sourceName}: ${String((step as any).raw || 'Choose cards')}`,
    mandatory: !built.optional,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    searchCriteria: String((step as any).raw || 'Choose cards to move'),
    minSelections: built.minSelections,
    maxSelections: built.maxSelections,
    destination: built.destination,
    reveal: false,
    shuffleAfter: built.shuffleAfter,
    remainderDestination: built.remainderDestination,
    remainderRandomOrder: built.remainderRandomOrder,
    remainderPlayerChoosesOrder: built.remainderPlayerChoosesOrder,
    availableCards,
    nonSelectableCards,
    filter: built.filter,
    persistLibrarySearchResolve: true,
    persistLibrarySearchResolveReason: 'stack_resolution',
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
  };
}

function collectMoveZoneChoiceSteps(
  result: OracleIRExecutionResult,
): Extract<OracleEffectStep, { kind: 'move_zone' }>[] {
  const steps: Extract<OracleEffectStep, { kind: 'move_zone' }>[] = [];
  const seen = new Set<string>();

  const isLandPlayFromHandStep = (
    step: Extract<OracleEffectStep, { kind: 'move_zone' }>,
  ): boolean => isControllerMayPutLandFromHandStep(step)
    || isEachPlayerMayPutLandFromHandStep(step)
    || isBothPlayersMayPutPermanentFromHandStep(step);

  for (const gap of result.automationGaps || []) {
    if (String(gap.stepKind || '') !== 'move_zone') continue;
    if (!isOracleIrPlayerChoiceGap(gap)) {
      continue;
    }
    const destinationChoice = (gap.metadata as any)?.moveZoneDestinationChoice;
    if (Array.isArray(destinationChoice) && destinationChoice.length > 0) {
      // Handled by queueMoveZoneDestinationChoicePromptsFromOracleIRResult (OPTION_CHOICE).
      continue;
    }
    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
    if (!step || isLandPlayFromHandStep(step)) continue;
    const key = `${String((step as any).raw || '')}:${String((step.what as any)?.text || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(step);
  }

  for (const step of result.skippedSteps || []) {
    if (step.kind !== 'move_zone') continue;
    const moveStep = step as Extract<OracleEffectStep, { kind: 'move_zone' }>;
    const isDestinationChoiceGap = (result.automationGaps || []).some((gap) => {
      if (String(gap.stepKind || '') !== 'move_zone') return false;
      const destinations = (gap.metadata as any)?.moveZoneDestinationChoice;
      if (!Array.isArray(destinations) || destinations.length === 0) return false;
      return findSkippedOracleStep(result, gap) === moveStep;
    });
    if (isDestinationChoiceGap) continue;
    if (isLandPlayFromHandStep(moveStep)) continue;
    const key = `${String((moveStep as any).raw || '')}:${String((moveStep.what as any)?.text || '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    steps.push(moveStep);
  }

  return steps;
}

function queueMoveZoneChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const step of collectMoveZoneChoiceSteps(result)) {
    const built = buildMoveZoneSelectionOptions(state, step, params.irCtx);
    if (!built) continue;

    const queueKey = `move_zone:${String((step as any).raw || '')}:${String((step.what as any)?.text || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const prompt = buildMoveZoneLibrarySearchPrompt(step, built, {
      controller: params.controller,
      sourceName,
      sourceId,
    });
    ResolutionQueueManager.addStep(
      gameId,
      attachOracleIrResumeMetadata(prompt, result, params) as any,
    );
  }
}

function queueMoveZoneDestinationChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();
  const priorChosenObjectIds = [
    ...(Array.isArray(params.irCtx.selectorContext?.chosenObjectIds)
      ? params.irCtx.selectorContext!.chosenObjectIds
      : []),
    ...(Array.isArray((params.irCtx as any).chosenObjectIds)
      ? (params.irCtx as any).chosenObjectIds
      : []),
  ]
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'move_zone') continue;

    const destinations = (gap.metadata as any)?.moveZoneDestinationChoice;
    if (!Array.isArray(destinations) || destinations.length === 0) continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'move_zone' }> | undefined;
    if (!step || step.kind !== 'move_zone') continue;

    const queueKey = `move_zone_destination:${String((step as any).raw || '')}:${destinations.join(',')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const options = destinations.map((destination) => {
      const normalized = String(destination || '').trim();
      return {
        id: normalized,
        label: normalized === 'battlefield' ? 'Put onto the battlefield' : 'Put into your hand',
        description: normalized,
      };
    });

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description: `${sourceName}: Put the chosen cards onto the battlefield or into your hand`,
      mandatory: true,
      sourceId,
      sourceName,
      options,
      minSelections: 1,
      maxSelections: 1,
      oracleIrMoveZoneDestinationChoice: true,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrPriorChosenObjectIdsJson: JSON.stringify(Array.from(new Set(priorChosenObjectIds))),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, { ...params, controller: params.controller }) as any);
  }
}

function collectGrantGraveyardPermissionModifyMetadata(
  result: OracleIRExecutionResult,
): { withoutPayingManaCost: boolean; exileAfterResolution: boolean } {
  const steps = [
    ...(result.skippedSteps || []),
    ...(result.pendingContinuationSteps || []),
    ...(result.appliedSteps || []),
  ];
  for (const step of steps) {
    if (step.kind !== 'modify_graveyard_permissions') continue;
    return {
      withoutPayingManaCost: (step as any).withoutPayingManaCost === true,
      exileAfterResolution: (step as any).exileInsteadOfGraveyard === true,
    };
  }
  return { withoutPayingManaCost: false, exileAfterResolution: false };
}

function resolveGrantGraveyardCastChoiceCard(
  state: any,
  controller: PlayerID,
  irCtx: OracleIRExecutionContext,
  triggerItem?: any,
): any | undefined {
  const chosenIds = new Set<string>([
    ...((irCtx.selectorContext as any)?.chosenObjectIds || irCtx.chosenObjectIds || []),
    String(triggerItem?.effectData?.discardedCardId || '').trim(),
    String(triggerItem?.boundGraveyardCardId || '').trim(),
    ...(Array.isArray(triggerItem?.targets)
      ? triggerItem.targets.map((target: any) => String(typeof target === 'string' ? target : target?.id || '').trim())
      : []),
  ].filter(Boolean));

  const searchPlayerIds = [String(controller), ...Object.keys(state?.zones || {}).filter((id) => id !== String(controller))];
  for (const playerId of searchPlayerIds) {
    const graveyard = Array.isArray(state?.zones?.[playerId]?.graveyard)
      ? state.zones[playerId].graveyard
      : [];
    for (const card of graveyard) {
      const cardId = String(card?.id || '').trim();
      if (!cardId) continue;
      if (chosenIds.size === 0 || chosenIds.has(cardId)) {
        return card;
      }
    }
  }
  return undefined;
}

function impulseDurationToPlayWindowText(duration: string): string {
  const normalized = String(duration || '').trim();
  if (normalized === 'until_end_of_next_turn' || normalized === 'until_next_turn') {
    return 'until the end of your next turn';
  }
  if (normalized === 'this_turn' || normalized === 'during_resolution') {
    return 'this turn';
  }
  return 'this turn';
}

function collectPendingImpulseExileChoiceCards(state: any, sourceName: string): any[] {
  const normalizedSource = String(sourceName || '').trim();
  if (!normalizedSource) return [];

  const cards: any[] = [];
  const seen = new Set<string>();

  const appendFromExile = (exileZone: any[], requireSourceMatch: boolean) => {
    for (const card of exileZone) {
      const cardId = String(card?.id || '').trim();
      if (!cardId || seen.has(cardId)) continue;
      if (card?.canBePlayedBy) continue;
      if (requireSourceMatch && String(card?.exiledBy || '').trim() !== normalizedSource) continue;
      seen.add(cardId);
      cards.push(card);
    }
  };

  for (const player of state?.players || []) {
    appendFromExile(Array.isArray(player?.exile) ? player.exile : [], true);
  }

  const zones = state?.zones || {};
  for (const ownerId of Object.keys(zones)) {
    appendFromExile(Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : [], true);
  }

  if (cards.length > 1) return cards;

  seen.clear();
  const fallbackCards: any[] = [];
  const appendFallback = (exileZone: any[]) => {
    for (const card of exileZone) {
      const cardId = String(card?.id || '').trim();
      if (!cardId || seen.has(cardId)) continue;
      if (card?.canBePlayedBy) continue;
      seen.add(cardId);
      fallbackCards.push(card);
    }
  };

  for (const player of state?.players || []) {
    appendFallback(Array.isArray(player?.exile) ? player.exile : []);
  }
  for (const ownerId of Object.keys(zones)) {
    appendFallback(Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : []);
  }

  return fallbackCards.length > 1 ? fallbackCards : cards;
}

function syncGraveyardCastFreeExilePermissionsFromOracleIR(
  state: any,
  steps: readonly OracleEffectStep[],
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  if (String(irCtx.castFromZone || '').trim().toLowerCase() !== 'graveyard') return;

  const expectsFreeExileCast = steps.some((step) => {
    if (step.kind === 'modify_exile_permissions' && step.withoutPayingManaCost) return true;
    if (step.kind !== 'conditional') return false;
    return (step.steps || []).some(
      (inner) => inner.kind === 'modify_exile_permissions' && inner.withoutPayingManaCost,
    );
  });
  if (!expectsFreeExileCast) return;

  const appliedFreeModify = (result.appliedSteps || []).some(
    (step) => step.kind === 'modify_exile_permissions' && (step as any).withoutPayingManaCost,
  );
  if (appliedFreeModify) return;

  const impulseApplied = (result.appliedSteps || []).some((step) => step.kind === 'impulse_exile_top');
  if (!impulseApplied) return;

  const sourceName = String(irCtx.sourceName || '').trim();
  const patchCard = (card: any): any => {
    if (!card || typeof card !== 'object') return card;
    if (sourceName && String(card?.exiledBy || '').trim() && String(card?.exiledBy || '').trim() !== sourceName) {
      return card;
    }
    if (!card?.canBePlayedBy && !(state.playableFromExile && Object.values(state.playableFromExile).some(
      (entry: any) => entry && typeof entry === 'object' && entry[String(card?.id || '')] !== undefined,
    ))) {
      return card;
    }
    if (card?.castWithoutPayingManaCost === true) return card;
    return {
      ...card,
      withoutPayingManaCost: true,
      castWithoutPayingManaCost: true,
    };
  };

  if (Array.isArray(state.players)) {
    state.players = state.players.map((player: any) => {
      const exile = Array.isArray(player?.exile) ? player.exile : [];
      if (exile.length === 0) return player;
      const updatedExile = exile.map(patchCard);
      if (updatedExile.some((card: any, index: number) => card !== exile[index])) {
        return { ...player, exile: updatedExile };
      }
      return player;
    });
  }

  const zones = state?.zones;
  if (zones && typeof zones === 'object') {
    for (const ownerId of Object.keys(zones)) {
      const exile = Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : [];
      if (exile.length === 0) continue;
      const updatedExile = exile.map(patchCard);
      if (updatedExile.some((card: any, index: number) => card !== exile[index])) {
        zones[ownerId] = {
          ...zones[ownerId],
          exile: updatedExile,
        };
      }
    }
  }
}

function syncImpulseExilePlayPermissionsToState(state: any): void {
  if (!state || typeof state !== 'object') return;

  state.playableFromExile = state.playableFromExile || {};
  const patchZones = (exile: any[]) => {
    for (const card of exile) {
      const cardId = String(card?.id || '').trim();
      const canBePlayedBy = String(card?.canBePlayedBy || '').trim();
      if (!cardId || !canBePlayedBy) continue;
      const until = typeof card?.playableUntilTurn === 'number' && Number.isFinite(card.playableUntilTurn)
        ? card.playableUntilTurn
        : Number.MAX_SAFE_INTEGER;
      if (typeof card.playableUntilTurn !== 'number' || !Number.isFinite(card.playableUntilTurn)) {
        card.playableUntilTurn = until;
      }
      state.playableFromExile[canBePlayedBy] = state.playableFromExile[canBePlayedBy] || {};
      state.playableFromExile[canBePlayedBy][cardId] = until;
    }
  };

  for (const player of state.players || []) {
    patchZones(Array.isArray(player?.exile) ? player.exile : []);
  }

  const zones = state.zones || {};
  for (const ownerId of Object.keys(zones)) {
    patchZones(Array.isArray(zones[ownerId]?.exile) ? zones[ownerId].exile : []);
  }
}

function queueChooseOneImpulseExilePlayPromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const appliedImpulseSteps = (result.appliedSteps || []).filter(
    (step) => step.kind === 'impulse_exile_top' && impulseExileTopRequiresChooseOne(step),
  );
  if (appliedImpulseSteps.length === 0) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const controllerId = String(params.controller || '').trim();
  if (!controllerId) return;

  const exiledCards = collectPendingImpulseExileChoiceCards(state, sourceName);
  if (exiledCards.length <= 1) return;

  const impulseStep = appliedImpulseSteps[appliedImpulseSteps.length - 1] as Extract<OracleEffectStep, { kind: 'impulse_exile_top' }>;
  const playableUntilTurn = getPlayableUntilTurnForImpulseDuration(state, impulseStep.duration) ?? Number(state?.turnNumber ?? 0);
  const playWindowText = impulseDurationToPlayWindowText(String(impulseStep.duration || ''));
  const exiledCardIds = exiledCards.map((card: any) => String(card?.id || '').trim()).filter(Boolean);
  if (exiledCardIds.length <= 1) return;

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controllerId,
    description: `${sourceName}: Choose an exiled card. You may play it ${playWindowText}.`,
    mandatory: true,
    sourceName,
    options: exiledCards.map((card: any) => ({
      id: String(card.id),
      label: String(card.name || 'Exiled card'),
      description: String(card.type_line || ''),
    })),
    minSelections: 1,
    maxSelections: 1,
    grantPlayableFromExileChoice: true,
    grantPlayableFromExileController: controllerId,
    grantPlayableFromExileSourceName: sourceName,
    grantPlayableFromExileCardIds: exiledCardIds,
    grantPlayableFromExileUntilTurn: playableUntilTurn,
    grantPlayableFromExileWindowText: playWindowText,
  } as any);
}

function queueOptionalStepChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx?: OracleIRExecutionContext;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (gap.reasonCode !== 'optional_step_requires_player_choice') continue;
    const stepKind = String(gap.stepKind || '');
    if (
      stepKind !== 'move_zone'
      && stepKind !== 'grant_graveyard_permission'
      && stepKind !== 'attach'
    ) {
      continue;
    }

    const step = findSkippedOracleStep(result, gap);
    if (!step) continue;

    if (isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt(step)) {
      continue;
    }

    if (
      stepKind === 'move_zone'
      && step.kind === 'move_zone'
      && params.irCtx
      && buildMoveZoneSelectionOptions(state, step, params.irCtx)
    ) {
      // queueMoveZoneChoicePromptsFromOracleIRResult queues LIBRARY_SEARCH (or graveyard UX).
      continue;
    }

    const queueKey = `${stepKind}:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;

    if (
      stepKind === 'grant_graveyard_permission'
      && step.kind === 'grant_graveyard_permission'
      && params.irCtx
    ) {
      const graveyardCard = resolveGrantGraveyardCastChoiceCard(
        state,
        params.controller,
        params.irCtx,
        params.triggerItem,
      );
      if (graveyardCard) {
        queuedKeys.add(queueKey);
        const cardId = String(graveyardCard?.id || '').trim();
        const cardName = String(graveyardCard?.name || 'that card').trim() || 'that card';
        const permission = String((step as any).permission || 'cast').toLowerCase();
        const modify = collectGrantGraveyardPermissionModifyMetadata(result);
        const isLandCard = /\bland\b/i.test(String(graveyardCard?.type_line || ''));
        const actionLabel = permission === 'play' || isLandCard ? 'Play' : 'Cast';
        const promptDescription = isLandCard
          ? `${sourceName}: You may play ${cardName} from your graveyard.`
          : modify.withoutPayingManaCost
            ? `${sourceName}: You may cast ${cardName} from your graveyard without paying its mana cost.`
            : `${sourceName}: You may cast ${cardName} from your graveyard.`;

        if (permission === 'play' || isLandCard) {
          const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: params.controller,
            sourceId,
            sourceName,
            description: promptDescription,
            mandatory: false,
            options: [
              { id: 'play', label: `${actionLabel} ${cardName}` },
              { id: 'decline', label: 'Decline' },
            ],
            minSelections: 1,
            maxSelections: 1,
            playFromGraveyardCardId: cardId,
            playFromGraveyardCard: {
              ...(graveyardCard as any),
              ...(modify.exileAfterResolution ? { exileAfterResolution: true } : null),
            },
            playFromGraveyardWithoutPayingManaCost: modify.withoutPayingManaCost,
            ...(modify.exileAfterResolution ? { playFromGraveyardExileAfterResolution: true } : null),
            oracleIrControllerId: params.controller,
            oracleIrSourceId: sourceId,
            oracleIrSourceName: sourceName,
          } as any, result, params) as any);
          appendQueuedResolutionPromptEvent(ctx, {
            playerId: params.controller,
            sourceId,
            queuedResolutionStep: queuedStep,
          });
        } else {
          const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: params.controller,
            sourceId,
            sourceName,
            description: promptDescription,
            mandatory: false,
            options: [
              { id: 'cast', label: `${actionLabel} ${cardName}` },
              { id: 'decline', label: 'Decline' },
            ],
            minSelections: 1,
            maxSelections: 1,
            castFromGraveyardCardId: cardId,
            castFromGraveyardCard: {
              ...(graveyardCard as any),
              ...(modify.exileAfterResolution ? { exileAfterResolution: true } : null),
            },
            castFromGraveyardWithoutPayingManaCost: modify.withoutPayingManaCost,
            ...(modify.exileAfterResolution ? { castFromGraveyardExileAfterResolution: true } : null),
            oracleIrControllerId: params.controller,
            oracleIrSourceId: sourceId,
            oracleIrSourceName: sourceName,
          } as any, result, params) as any);
          appendQueuedResolutionPromptEvent(ctx, {
            playerId: params.controller,
            sourceId,
            queuedResolutionStep: queuedStep,
          });
        }
        continue;
      }
    }

    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description: `${sourceName}: ${String((step as any).raw || 'You may')}`,
      mandatory: false,
      sourceId,
      sourceName,
      options: [
        { id: 'accept', label: 'Yes', description: 'Accept' },
        { id: 'decline', label: 'No', description: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      optionalPaymentPrompt: true,
      optionalPaymentPayChoiceId: 'accept',
      optionalPaymentDeclineChoiceId: 'decline',
      oracleIrOptionalMayChoice: true,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function persistUnqueuedPendingContinuationFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    resolutionQueueStepsBefore: number;
    resolutionQueueStepsAfter: number;
  },
): void {
  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending.length === 0) return;
  if (params.resolutionQueueStepsAfter > params.resolutionQueueStepsBefore) return;
  if (String(state?.oracleIrPendingResumeStepsJson || '').trim()) return;

  state.oracleIrPendingResumeStepsJson = JSON.stringify(unwrapYouDoResumeSteps(pending));
  state.oracleIrPendingResumeControllerId = params.controller;
  if (params.sourceId) state.oracleIrPendingResumeSourceId = params.sourceId;
  if (params.sourceName) state.oracleIrPendingResumeSourceName = params.sourceName;
}

function queueUnlessPayChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    triggerItem?: any;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const triggerItem = params.triggerItem;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) {
      continue;
    }

    const stepKind = String(gap.stepKind || '');
    const gapRaw = String(gap.raw || '');
    const queueKey = `${stepKind}:${gapRaw}`;
    if (queuedKeys.has(queueKey)) continue;

    const metadata = (gap.metadata || {}) as Record<string, unknown>;
    const unlessPayManaCost = normalizeOracleManaCostString(String(metadata.unlessPayManaCost || '').trim());
    const unlessPayLifeAmount = Number(metadata.unlessPayLifeAmount);

    if (stepKind === 'sacrifice' && unlessPayManaCost && sourceId) {
      queuedKeys.add(queueKey);
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: params.controller,
        sourceId,
        sourceName,
        description: `${sourceName}: Pay ${unlessPayManaCost} or sacrifice it.`,
        mandatory: false,
        activationPaymentChoice: true,
        confirmLabel: `Pay ${unlessPayManaCost}`,
        permanentId: sourceId,
        cardName: sourceName,
        manaCost: unlessPayManaCost,
        sacrificeUnlessPayChoice: true,
      } as any, result, params) as any);
      continue;
    }

    const skippedStep = findSkippedOracleStep(result, gap);

    if (stepKind === 'pay_mana' && skippedStep?.kind === 'pay_mana') {
      const manaCost = normalizeOracleManaCostString(String((skippedStep as any).mana || metadata.manaCost || '').trim());
      if (!manaCost) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: You may pay ${manaCost}. If you do, copy that ability.`,
        mandatory: false,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: `Pay ${manaCost}`, description: `Pay ${manaCost}` },
          { id: 'decline', label: 'Decline', description: 'Decline to pay' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind: 'mana',
        optionalPaymentManaCost: manaCost,
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrOptionalPayManaChoice: true,
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        copyTriggeredAbilityDeclineEvent: true,
        copyTriggeredAbilitySourceId: String(triggerItem?.source || triggerItem?.permanentId || sourceId || '').trim() || undefined,
        copyTriggeredAbilityTriggerStackItemId: String(triggerItem?.id || '').trim() || undefined,
        copyTriggeredAbilityTriggeringStackItemId: String(
          triggerItem?.triggeringStackItemId
          || triggerItem?.effectData?.triggeringStackItemId
          || params.irCtx.targetSpellId
          || '',
        ).trim() || undefined,
      } as any, result, params) as any);
      continue;
    }

    if (stepKind === 'unless_pays_mana' && skippedStep?.kind === 'unless_pays_mana') {
      const manaCost = normalizeOracleManaCostString(String((skippedStep as any).mana || metadata.manaCost || '').trim());
      if (!manaCost) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      const boundTargetSpellId = resolveOracleIrBoundTargetSpellId(params.irCtx);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: ${gapRaw || `Pay ${manaCost} or decline`}`,
        mandatory: true,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: `Pay ${manaCost}`, description: `Pay ${manaCost}` },
          { id: 'decline', label: 'Decline', description: 'Decline to pay' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind: 'mana',
        optionalPaymentManaCost: manaCost,
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrUnlessPayChoice: true,
        oracleIrUnlessPayKind: 'mana',
        oracleIrUnlessPayStepsJson: JSON.stringify([skippedStep]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        ...(boundTargetSpellId ? { oracleIrTargetSpellId: boundTargetSpellId } : {}),
      } as any, result, params) as any);
      continue;
    }

    if (stepKind === 'unless_pays_life' && skippedStep?.kind === 'unless_pays_life') {
      const lifeAmount = Number(
        (skippedStep as any).amount ??
          metadata.lifeAmount ??
          unlessPayLifeAmount
      );
      if (!Number.isFinite(lifeAmount) || lifeAmount <= 0) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      const boundTargetSpellId = resolveOracleIrBoundTargetSpellId(params.irCtx);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: ${gapRaw || `Pay ${lifeAmount} life or decline`}`,
        mandatory: true,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: `Pay ${lifeAmount} life`, description: `Pay ${lifeAmount} life` },
          { id: 'decline', label: 'Decline', description: 'Decline to pay life' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind: 'life',
        optionalPaymentLifeAmount: lifeAmount,
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrUnlessPayChoice: true,
        oracleIrUnlessPayKind: 'life',
        oracleIrUnlessPayStepsJson: JSON.stringify([skippedStep]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        ...(boundTargetSpellId ? { oracleIrTargetSpellId: boundTargetSpellId } : {}),
      } as any, result, params) as any);
    }

    if (stepKind === 'unless_discards' && skippedStep?.kind === 'unless_discards') {
      const discardAmount = Math.max(0, Number((skippedStep as any).amount ?? metadata.discardAmount ?? 0) | 0);
      if (discardAmount <= 0) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const discarderId = String(metadata.discarderId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      const cardWord = discardAmount === 1 ? 'card' : 'cards';
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: discarderId,
        description: `${sourceName}: ${gapRaw || `Discard ${discardAmount} ${cardWord} or decline`}`,
        mandatory: true,
        sourceId,
        sourceName,
        options: [
          { id: 'discard', label: `Discard ${discardAmount} ${cardWord}`, description: `Discard ${discardAmount} ${cardWord}` },
          { id: 'decline', label: 'Decline', description: 'Decline to discard' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentPayChoiceId: 'discard',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrUnlessDiscardsChoice: true,
        oracleIrUnlessDiscardsStepsJson: JSON.stringify([skippedStep]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
    }
  }
}

export function resumeOracleIRUnlessDiscardsFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    choice: 'discard' | 'decline';
    targetPlayerId?: PlayerID;
  },
): OracleIRExecutionResult {
  const choiceBinding = { unlessDiscardsChoice: params.choice };

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      selectorContext: choiceBinding,
      ...choiceBinding,
    },
    {
      targetPlayerId: params.targetPlayerId,
    },
  );

  return applyOracleIRStepsOnServer(
    ctx,
    (ctx as any).state,
    params.steps,
    irCtx,
    { allowOptional: false },
    {
      controller: params.controller,
      targetPlayerId: params.targetPlayerId,
    },
  );
}

export function resumeOracleIRUnlessPayFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    unlessPayKind: 'mana' | 'life';
    choice: 'pay' | 'decline';
    targetPlayerId?: PlayerID;
    targetSpellId?: string;
  },
): OracleIRExecutionResult {
  const choiceBinding =
    params.unlessPayKind === 'mana'
      ? { unlessPaysManaChoice: params.choice as 'pay' | 'decline' }
      : { unlessPaysLifeChoice: params.choice as 'pay' | 'decline' };

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      selectorContext: choiceBinding,
      ...choiceBinding,
    },
    {
      targetPlayerId: params.targetPlayerId,
      targetSpellId: params.targetSpellId,
    },
  );

  return applyOracleIRStepsOnServer(
    ctx,
    (ctx as any).state,
    params.steps,
    irCtx,
    { allowOptional: false },
    {
      controller: params.controller,
      targetPlayerId: params.targetPlayerId,
    },
  );
}

export function resumeOracleIRRemainingStepsFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    targetPlayerId?: PlayerID;
    targetSpellId?: string;
    triggerItem?: any;
    chosenObjectIds?: readonly string[];
    selectorContext?: Record<string, unknown>;
    xValue?: number;
    voteChoiceCounts?: Readonly<Record<string, number>>;
    winningVoteChoice?: string | null;
  },
): OracleIRExecutionResult | null {
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    return null;
  }

  const state = (ctx as any).state;
  const continuationStepIndex = resolveOracleIrContinuationStepIndex(state);
  const chosenObjectIds = (params.chosenObjectIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const selectorContext = params.selectorContext
    ?? (chosenObjectIds.length > 0 ? { chosenObjectIds } : undefined);
  const xValue = Number(params.xValue);

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      currentStepIndex: continuationStepIndex,
      stepLedger: readStepLedgerFromState(state),
      appliedStepKinds: readAppliedStepKindsFromState(state),
      ...(Number.isFinite(xValue) ? { xValue } : {}),
      ...(selectorContext ? { selectorContext } : {}),
      ...(params.voteChoiceCounts ? { voteChoiceCounts: params.voteChoiceCounts } : {}),
      ...(typeof params.winningVoteChoice !== 'undefined'
        ? { winningVoteChoice: params.winningVoteChoice }
        : {}),
    },
    {
      targetPlayerId: params.targetPlayerId,
      targetSpellId: params.targetSpellId,
      ...(chosenObjectIds.length > 0 ? { chosenObjectIds } : {}),
      ...(params.voteChoiceCounts ? { voteChoiceCounts: params.voteChoiceCounts } : {}),
      ...(typeof params.winningVoteChoice !== 'undefined'
        ? { winningVoteChoice: params.winningVoteChoice }
        : {}),
    },
  );

  const controller = String(params.controller || '').trim() as PlayerID;
  if (!controller) {
    return null;
  }

  const handIdsBefore = new Set<string>(
    ((ctx as any).state?.zones?.[controller]?.hand || [])
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean),
  );

  const optionalTriggerAccepted = params.triggerItem?.optionalTriggeredAbilityDecisionApplied === true;
  const result = applyOracleIRStepsOnServer(
    ctx,
    state,
    params.steps,
    irCtx,
    { allowOptional: optionalTriggerAccepted },
    {
      controller,
      targetPlayerId: params.targetPlayerId,
      triggerItem: params.triggerItem,
      compoundResume: true,
    },
  );

  if (result && !(ctx as any).isReplaying) {
    persistOracleIrCompoundDrawAfterResolution(ctx, {
      controller,
      result,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      handIdsBefore,
    });
  }

  return result;
}

export function resumeOracleIRStepWithChoiceFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    chosenObjectIds?: readonly string[];
    selectorContext?: Record<string, unknown>;
    targetPlayerId?: PlayerID;
    targetSpellId?: string;
    allowOptional?: boolean;
    xValue?: number;
  },
): OracleIRExecutionResult | null {
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    return null;
  }

  const chosenObjectIds = (params.chosenObjectIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const selectorContext = {
    ...(params.selectorContext || {}),
    ...(chosenObjectIds.length > 0 ? { chosenObjectIds } : {}),
  };

  const state = (ctx as any).state;
  const choiceStepIndex = resolveOracleIrChoiceStepIndex(state);
  const xValue = Number(params.xValue);

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      currentStepIndex: choiceStepIndex,
      stepLedger: readStepLedgerFromState(state),
      appliedStepKinds: readAppliedStepKindsFromState(state),
      ...(Number.isFinite(xValue) ? { xValue } : {}),
      ...(typeof params.selectorContext?.targetPermanentId === 'string'
        ? { targetPermanentId: String(params.selectorContext.targetPermanentId) }
        : {}),
      selectorContext,
    },
    {
      targetPlayerId: params.targetPlayerId,
      targetSpellId: params.targetSpellId,
      targetPermanentId: typeof params.selectorContext?.targetPermanentId === 'string'
        ? String(params.selectorContext.targetPermanentId)
        : undefined,
      chosenObjectIds: chosenObjectIds.length > 0 ? chosenObjectIds : undefined,
      ...(params.selectorContext || {}),
    },
  );

  return applyOracleIRStepsOnServer(
    ctx,
    state,
    params.steps,
    irCtx,
    { allowOptional: params.allowOptional === true },
    {
      controller: params.controller,
      targetPlayerId: params.targetPlayerId,
    },
  );
}

export function maybeApplyOracleIrChoiceStepFromResolution(
  ctx: GameContext,
  step: any,
  response: {
    readonly selections?: unknown;
    readonly cancelled?: boolean;
    readonly splitAssignments?: { toBattlefield?: string[]; toHand?: string[] };
  },
): OracleIRExecutionResult | null {
  if (response.cancelled) {
    return null;
  }

  if (step?.oracleIrMoveZoneDestinationChoice === true) {
    const choiceJson = String(step?.oracleIrChoiceStepJson || '').trim();
    if (!choiceJson) return null;

    let choiceSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(choiceJson);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      choiceSteps = parsed as OracleEffectStep[];
    } catch {
      return null;
    }

    const destination = extractOracleIrSelectionIds(response.selections)[0] || '';
    if (!destination) return null;

    let priorChosenObjectIds: string[] = [];
    try {
      const parsedPrior = JSON.parse(String(step?.oracleIrPriorChosenObjectIdsJson || '[]'));
      if (Array.isArray(parsedPrior)) {
        priorChosenObjectIds = parsedPrior.map((id) => String(id || '').trim()).filter(Boolean);
      }
    } catch {
      priorChosenObjectIds = [];
    }

    const controller = String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID;
    const xValue = Number(step?.oracleIrXValue);

    return resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller,
      sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
      sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
      steps: choiceSteps,
      ...(priorChosenObjectIds.length > 0 ? { chosenObjectIds: priorChosenObjectIds } : {}),
      selectorContext: {
        moveZoneDestination: destination,
        ...(priorChosenObjectIds.length > 0 ? { chosenObjectIds: priorChosenObjectIds } : {}),
      },
      ...(Number.isFinite(xValue) ? { xValue } : {}),
    });
  }

  const choiceJson = String(step?.oracleIrChoiceStepJson || '').trim();
  if (!choiceJson) {
    return null;
  }

  let choiceSteps: OracleEffectStep[] = [];
  try {
    const parsed = JSON.parse(choiceJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    choiceSteps = parsed as OracleEffectStep[];
  } catch {
    return null;
  }

  const firstStep = choiceSteps[0];
  const playerChoiceKind = String(step?.oracleIrPlayerChoiceKind || (firstStep as any)?.choice || '').trim();
  const selectionIds = extractOracleIrSelectionIds(response.selections);
  const controller = String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID;
  const probeCtx = buildOracleIRExecutionContext({
    controllerId: controller,
    sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
    sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
    targetPermanentId: String(step?.oracleIrTargetPermanentId || '').trim() || undefined,
  });

  let chosenObjectIds: string[] | undefined;
  let selectorContext: Record<string, unknown> | undefined;
  let targetPermanentId: string | undefined = String(step?.oracleIrTargetPermanentId || '').trim() || undefined;

  if (firstStep?.kind === 'connive') {
    targetPermanentId = targetPermanentId
      || resolveSingleCreatureTargetId((ctx as any).state, (firstStep as any).target, probeCtx)
      || undefined;
  }

  if (firstStep?.kind === 'add_mana') {
    const selectionKind = String(step?.selectionKind || 'any_color');
    if (selectionKind === 'distribution') {
      const distribution = response.selections;
      if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) {
        return null;
      }
      const chosenMana = buildChosenManaFromDistribution(distribution as Record<string, unknown>);
      if (!chosenMana) {
        return null;
      }
      selectorContext = { chosenMana };
    } else {
      const poolKey = typeof response.selections === 'string'
        ? response.selections
        : selectionIds[0];
      const chosenMana = poolKeyToManaSymbol(String(poolKey || ''));
      if (!chosenMana) {
        return null;
      }
      selectorContext = { chosenMana };
    }
  } else if (
    firstStep?.kind === 'add_counter'
    && (
      (firstStep as any).distribution === 'among'
      || /^distribute\b/i.test(String((firstStep as any).raw || ''))
    )
    && response.selections
    && typeof response.selections === 'object'
    && !Array.isArray(response.selections)
  ) {
    const distribution = response.selections;
    if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) {
      return null;
    }
    const counterDistributionByTargetId: Record<string, number> = {};
    for (const [targetId, amountRaw] of Object.entries(distribution as Record<string, unknown>)) {
      const amount = Number(amountRaw ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      counterDistributionByTargetId[String(targetId || '').trim()] = Math.floor(amount);
    }
    if (Object.keys(counterDistributionByTargetId).length === 0) {
      return null;
    }
    chosenObjectIds = Object.keys(counterDistributionByTargetId);
    selectorContext = { counterDistributionByTargetId, chosenObjectIds };
  } else if (firstStep?.kind === 'choose_pile' || playerChoiceKind === 'choose_pile') {
    const pileId = selectionIds[0] || '';
    if (!pileId) {
      return null;
    }
    selectorContext = { chosenPile: pileId, pileChoice: pileId };
  } else if (firstStep?.kind === 'change_target') {
    const phase = String(step?.oracleIrChangeTargetPhase || 'choose_spell').trim();
    if (phase === 'choose_new_target') {
      const chosenSpellId = String(step?.oracleIrTargetSpellId || '').trim();
      if (!chosenSpellId || selectionIds.length === 0) {
        return null;
      }
      chosenObjectIds = [chosenSpellId, ...selectionIds];
      selectorContext = { chosenSpellId, chosenObjectIds };
    } else if (selectionIds.length === 0) {
      return null;
    } else {
      chosenObjectIds = selectionIds;
      selectorContext = { chosenSpellId: selectionIds[0], chosenObjectIds: selectionIds };
    }
  } else if (firstStep?.kind === 'scry' || firstStep?.kind === 'surveil') {
    const orderingContext = extractOracleIrTopLibraryOrderingFromResponse(
      firstStep.kind,
      response.selections,
    );
    if (!orderingContext) {
      return null;
    }
    selectorContext = orderingContext;
  } else if (
    firstStep?.kind === 'connive'
    || firstStep?.kind === 'discard'
    || firstStep?.kind === 'sacrifice'
    || firstStep?.kind === 'search_library'
    || firstStep?.kind === 'move_zone'
  ) {
    if (selectionIds.length === 0) {
      return null;
    }
    chosenObjectIds = selectionIds;
    const splitAssignments = (response as { splitAssignments?: { toBattlefield?: string[]; toHand?: string[] } }).splitAssignments;
    if (splitAssignments && typeof splitAssignments === 'object' && !Array.isArray(splitAssignments)) {
      selectorContext = { chosenObjectIds: selectionIds, splitAssignments };
    }
  } else if (
    firstStep?.kind === 'redistribute_life_totals'
    && response.selections
    && typeof response.selections === 'object'
    && !Array.isArray(response.selections)
  ) {
    const payload = response.selections as Record<string, unknown>;
    const lifeByPlayerIdRaw = payload.lifeByPlayerId ?? payload;
    if (!lifeByPlayerIdRaw || typeof lifeByPlayerIdRaw !== 'object' || Array.isArray(lifeByPlayerIdRaw)) {
      return null;
    }
    const lifeRedistributionByPlayerId: Record<string, number> = {};
    for (const [playerId, amountRaw] of Object.entries(lifeByPlayerIdRaw as Record<string, unknown>)) {
      const normalizedId = String(playerId || '').trim();
      if (!normalizedId) continue;
      const amount = Number(amountRaw ?? NaN);
      if (!Number.isFinite(amount)) continue;
      lifeRedistributionByPlayerId[normalizedId] = Math.max(0, Math.floor(amount));
    }
    selectorContext = { lifeRedistributionByPlayerId };
  } else if (firstStep?.kind === 'player_choice' || playerChoiceKind) {
    const choiceId = selectionIds[0] || '';
    if (!choiceId) {
      return null;
    }
    if (playerChoiceKind === 'letter' || (firstStep as any)?.choice === 'letter') {
      selectorContext = { chosenLetter: choiceId.slice(0, 1) };
    } else if (playerChoiceKind === 'odd_even' || (firstStep as any)?.choice === 'odd_even') {
      const normalized = choiceId.toLowerCase();
      if (normalized !== 'odd' && normalized !== 'even') {
        return null;
      }
      selectorContext = { chosenOddEven: normalized };
    } else if (playerChoiceKind === 'card_type' || (firstStep as any)?.choice === 'card_type') {
      selectorContext = { chosenCreatureType: choiceId };
    } else if (selectionIds.length > 0) {
      chosenObjectIds = selectionIds;
      selectorContext = { chosenObjectIds: selectionIds };
    } else {
      chosenObjectIds = [choiceId];
      selectorContext = { chosenObjectIds: [choiceId] };
    }
  } else if (selectionIds.length > 0) {
    chosenObjectIds = selectionIds;
  } else {
    return null;
  }

  const mergedSelectorContext = {
    ...(selectorContext || {}),
    ...(targetPermanentId ? { targetPermanentId } : {}),
  };

  return resumeOracleIRStepWithChoiceFromResolution(ctx, {
    controller,
    sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
    sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
    steps: choiceSteps,
    ...(chosenObjectIds ? { chosenObjectIds } : {}),
    ...(Object.keys(mergedSelectorContext).length > 0 ? { selectorContext: mergedSelectorContext } : {}),
    ...(Number.isFinite(Number(step?.oracleIrXValue)) ? { xValue: Number(step.oracleIrXValue) } : {}),
    allowOptional:
      (firstStep as { optional?: boolean })?.optional === true
      || /^you may\b/i.test(String((firstStep as any)?.raw || '')),
  });
}

export function syncAllOracleIRPlayerZonesAfterResolution(ctx: GameContext): void {
  const state = (ctx as any).state;
  if (!state) return;
  const graveyardBefore = snapshotGraveyardCardIds(state);
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim() as PlayerID;
    if (playerId) {
      syncOracleIRPlayerZonesToContext(ctx, state, playerId, graveyardBefore);
    }
  }
}

export function resolveOracleIrOptionalPaymentPromptFromResolution(
  ctx: GameContext,
  params: {
    step: any;
    choiceId: string;
    cancelled: boolean;
  },
): boolean {
  const step = params.step;
  const stepData = (step && typeof step === 'object') ? step as Record<string, unknown> : {};
  if (stepData.optionalPaymentPrompt !== true) return false;
  if (
    stepData.oracleIrUnlessPayChoice !== true
    && stepData.oracleIrOptionalPayManaChoice !== true
    && stepData.oracleIrOptionalMayChoice !== true
    && stepData.oracleIrUnlessDiscardsChoice !== true
  ) {
    return false;
  }

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') return false;

  const state = (ctx as any).state;

  const playerId = String(stepData.playerId || step?.playerId || '').trim() as PlayerID;
  const choiceId = String(params.choiceId || '').trim();
  const payChoiceId = String(stepData.optionalPaymentPayChoiceId || 'pay').trim();
  const paid = !params.cancelled && choiceId === payChoiceId;

  if (paid && String(stepData.optionalPaymentValidationKind || '') === 'mana') {
    const manaCost = String(stepData.optionalPaymentManaCost || stepData.manaCost || '').trim();
    if (manaCost) {
      payManaCostWithAvailableSources((ctx as any).state, playerId, manaCost);
    }
  }

  if (
    paid
    && (
      String(stepData.optionalPaymentValidationKind || '') === 'life'
      || stepData.oracleIrUnlessPayKind === 'life'
    )
  ) {
    const lifeAmount = Number(stepData.optionalPaymentLifeAmount || 0);
    if (Number.isFinite(lifeAmount) && lifeAmount > 0 && !(ctx as any).isReplaying) {
      try {
        queuePayLifeTriggers(ctx, playerId, lifeAmount, {
          sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
          sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || 'Oracle IR life payment').trim()
            || 'Oracle IR life payment',
        });
      } catch {
        // best-effort
      }
    }
  }

  if (paid) {
    if (stepData.oracleIrUnlessPayChoice === true) {
      let unlessSteps: OracleEffectStep[] = [];
      try {
        const parsed = JSON.parse(String(stepData.oracleIrUnlessPayStepsJson || '[]'));
        unlessSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
      } catch {
        unlessSteps = [];
      }
      if (unlessSteps.length > 0) {
        resumeOracleIRUnlessPayFromResolution(ctx, {
          controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
          sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
          sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
          steps: unlessSteps,
          unlessPayKind: stepData.oracleIrUnlessPayKind === 'life' ? 'life' : 'mana',
          choice: 'pay',
          targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
        });
      }
    } else if (stepData.oracleIrOptionalMayChoice === true) {
      let choiceSteps: OracleEffectStep[] = [];
      try {
        const parsed = JSON.parse(String(stepData.oracleIrChoiceStepJson || '[]'));
        choiceSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
      } catch {
        choiceSteps = [];
      }
      if (choiceSteps.length > 0) {
        resumeOracleIRStepWithChoiceFromResolution(ctx, {
          controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
          sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
          sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
          steps: choiceSteps,
          allowOptional: true,
        });
      }
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
    } else if (stepData.oracleIrUnlessDiscardsChoice === true) {
      let unlessDiscardsSteps: OracleEffectStep[] = [];
      try {
        const parsed = JSON.parse(String(stepData.oracleIrUnlessDiscardsStepsJson || '[]'));
        unlessDiscardsSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
      } catch {
        unlessDiscardsSteps = [];
      }
      if (unlessDiscardsSteps.length > 0) {
        resumeOracleIRUnlessDiscardsFromResolution(ctx, {
          controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
          sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
          sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
          steps: unlessDiscardsSteps,
          choice: 'discard',
        });
      }
    } else {
      maybeResumeOracleIRStepsAfterResolution(ctx, step);
    }
  } else if (stepData.oracleIrUnlessDiscardsChoice === true) {
    let unlessDiscardsSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(String(stepData.oracleIrUnlessDiscardsStepsJson || '[]'));
      unlessDiscardsSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
    } catch {
      unlessDiscardsSteps = [];
    }
    if (unlessDiscardsSteps.length > 0) {
      resumeOracleIRUnlessDiscardsFromResolution(ctx, {
        controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
        sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
        sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
        steps: unlessDiscardsSteps,
        choice: 'decline',
      });
    }
  } else if (stepData.oracleIrUnlessPayChoice === true) {
    let unlessSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(String(stepData.oracleIrUnlessPayStepsJson || '[]'));
      unlessSteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
    } catch {
      unlessSteps = [];
    }
    if (unlessSteps.length > 0) {
      resumeOracleIRUnlessPayFromResolution(ctx, {
        controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
        sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
        sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
        steps: unlessSteps,
        unlessPayKind: stepData.oracleIrUnlessPayKind === 'life' ? 'life' : 'mana',
        choice: 'decline',
        targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
      });
    }
  } else if (stepData.oracleIrOptionalMayChoice === true) {
    maybeResumeOracleIRStepsAfterResolution(ctx, step);
  } else if (stepData.copyTriggeredAbilityDeclineEvent === true) {
    appendCopyTriggeredAbilityResolveEvent(ctx, {
      sourceId: String(stepData.copyTriggeredAbilitySourceId || stepData.sourceId || '').trim() || undefined,
      sourceName: String(stepData.sourceName || 'Ability').trim() || 'Ability',
      controllerId: String(stepData.oracleIrControllerId || playerId).trim() || undefined,
      paid: false,
      manaCost: String(stepData.optionalPaymentManaCost || '').trim() || undefined,
      triggerStackItemId: String(stepData.copyTriggeredAbilityTriggerStackItemId || '').trim() || undefined,
      triggeringStackItemId: String(stepData.copyTriggeredAbilityTriggeringStackItemId || '').trim() || undefined,
    });
  }

  if (state) {
    syncAllOracleIRPlayerZonesAfterResolution(ctx);
  }

  if (typeof (ctx as any).bumpSeq === 'function') {
    (ctx as any).bumpSeq();
  }

  return true;
}

function buildOracleIrResumeContextFromResolutionStep(step: any): {
  chosenObjectIds?: string[];
  selectorContext?: Record<string, unknown>;
  voteChoiceCounts?: Record<string, number>;
  winningVoteChoice?: string | null;
} {
  const voteCountsRaw = step?.oracleIrVoteChoiceCounts;
  if (voteCountsRaw && typeof voteCountsRaw === 'object') {
    const voteChoiceCounts = Object.fromEntries(
      Object.entries(voteCountsRaw)
        .map(([choice, count]) => [String(choice || '').trim().toLowerCase(), Number(count) || 0])
        .filter(([choice]) => Boolean(choice)),
    );
    const winningRaw = step?.oracleIrWinningVoteChoice;
    const winningVoteChoice =
      winningRaw === null
        ? null
        : typeof winningRaw === 'string'
          ? winningRaw
          : undefined;
    return {
      voteChoiceCounts,
      ...(typeof winningVoteChoice !== 'undefined' ? { winningVoteChoice } : {}),
    };
  }

  const selectionIds = extractOracleIrSelectionIds(step?.response?.selections);
  if (selectionIds.length === 0) {
    return {};
  }

  const playerChoiceKind = String(step?.oracleIrPlayerChoiceKind || '').trim();
  if (playerChoiceKind === 'odd_even') {
    const normalized = selectionIds[0]!.toLowerCase();
    if (normalized === 'odd' || normalized === 'even') {
      return { selectorContext: { chosenOddEven: normalized } };
    }
  }
  if (playerChoiceKind === 'letter') {
    return { selectorContext: { chosenLetter: selectionIds[0]!.slice(0, 1) } };
  }

  return { chosenObjectIds: selectionIds };
}

export function maybeResumeOracleIRStepsAfterResolution(
  ctx: GameContext,
  step: any,
): OracleIRExecutionResult | null {
  const resumeJson = String(step?.oracleIrResumeStepsJson || '').trim();
  if (!resumeJson) {
    return null;
  }

  let remainingSteps: OracleEffectStep[] = [];
  try {
    const parsed = JSON.parse(resumeJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    remainingSteps = parsed as OracleEffectStep[];
  } catch {
    return null;
  }

  const resumeContext = buildOracleIrResumeContextFromResolutionStep(step);

  return resumeOracleIRRemainingStepsFromResolution(ctx, {
    controller: String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID,
    sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
    sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
    steps: remainingSteps,
    targetSpellId: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim() || undefined,
    ...(resumeContext.chosenObjectIds ? { chosenObjectIds: resumeContext.chosenObjectIds } : {}),
    ...(resumeContext.selectorContext ? { selectorContext: resumeContext.selectorContext } : {}),
    ...(resumeContext.voteChoiceCounts ? { voteChoiceCounts: resumeContext.voteChoiceCounts } : {}),
    ...(typeof resumeContext.winningVoteChoice !== 'undefined'
      ? { winningVoteChoice: resumeContext.winningVoteChoice }
      : {}),
    ...(Number.isFinite(Number(step?.oracleIrXValue))
      ? { xValue: Number(step.oracleIrXValue) }
      : {}),
    triggerItem: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim()
      ? {
          id: String(step?.copyTriggeredAbilityTriggerStackItemId || '').trim() || undefined,
          permanentId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
          source: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
          triggeringStackItemId: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim(),
          effectData: {
            triggeringStackItemId: String(step?.copyTriggeredAbilityTriggeringStackItemId || '').trim(),
          },
        }
      : undefined,
  });
}

export function resumeOracleIrPendingCompoundStepsFromState(
  ctx: GameContext,
): OracleIRExecutionResult | null {
  const state = (ctx as any).state;
  const resumeJson = String(state?.oracleIrPendingResumeStepsJson || '').trim();
  if (!resumeJson) return null;

  let remainingSteps: OracleEffectStep[] = [];
  try {
    const parsed = JSON.parse(resumeJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      clearOracleIrPendingCompoundResumeOnState(state);
      return null;
    }
    remainingSteps = parsed as OracleEffectStep[];
  } catch {
    return null;
  }

  const controller = String(
    state?.oracleIrPendingResumeControllerId || '',
  ).trim() as PlayerID;
  if (!controller) return null;

  const sourceId = String(state?.oracleIrPendingResumeSourceId || '').trim() || undefined;
  const sourceName = String(state?.oracleIrPendingResumeSourceName || '').trim() || undefined;

  const result = resumeOracleIRRemainingStepsFromResolution(ctx, {
    controller,
    sourceId,
    sourceName,
    steps: remainingSteps,
  });
  if (result) {
    clearOracleIrPendingCompoundResumeOnState(state);
  }
  return result;
}

export function processPendingOracleIrCompoundResumeOnContext(
  ctx: GameContext,
): OracleIRExecutionResult | null {
  if ((ctx as any).isReplaying) return null;
  const state = (ctx as any).state;
  if (!state || typeof state !== 'object') return null;
  if (!String(state.oracleIrPendingResumeStepsJson || '').trim()) return null;
  return resumeOracleIrPendingCompoundStepsFromState(ctx);
}

export function applyOracleIRStepsOnServer(
  ctx: GameContext,
  state: any,
  steps: readonly OracleEffectStep[],
  irCtx: OracleIRExecutionContext,
  options: OracleIRExecutionOptions,
  params?: {
    controller?: PlayerID;
    targetPlayerId?: PlayerID;
    applyMillReplacements?: boolean;
    triggerItem?: any;
    sourceItem?: any;
    oracleText?: string;
    compoundResume?: boolean;
  },
): OracleIRExecutionResult {
  hydrateOracleIRPlayerZonesFromContext(ctx, state);
  const gameId = String((ctx as any).gameId || 'unknown');
  const graveyardBefore = snapshotGraveyardCardIds(state);
  const exileBefore = snapshotExileCardIds(state);
  const controllersBefore = snapshotBattlefieldControllers(state);
  const countersBefore = snapshotBattlefieldCounters(state);
  const permanentPatchesBefore = snapshotBattlefieldPermanentReplayPatches(state);
  const triggerEmissionBefore = snapshotBattlefieldForTriggerEmission(state);
  const stackBeforeCounter = Array.isArray((state as any).stack)
    ? ((state as any).stack as any[]).map((item) => ({
        id: String(item?.id || ''),
        type: String(item?.type || ''),
        controller: String(item?.controller || ''),
        cardName: String(item?.card?.name || item?.name || 'spell'),
      }))
    : [];

  const controller = (params?.controller || irCtx.controllerId) as PlayerID;
  const adjustedSteps = params?.applyMillReplacements === false
    ? [...steps]
    : applyMillReplacementEffectsToSteps(
        ctx,
        [...steps],
        controller,
        params?.targetPlayerId,
        state,
        irCtx,
      );

  const stepLedger = createEmptyStepLedger(
    irCtx.stepLedger ?? readStepLedgerFromState(state),
  );
  const appliedStepKinds = irCtx.appliedStepKinds
    ? new Map(irCtx.appliedStepKinds)
    : readAppliedStepKindsFromState(state);
  const transitionHaltState: OracleIRTransitionHaltState = irCtx.transitionHaltState ?? {
    halted: false,
    deferred: [],
  };
  const serverBridge = createOracleIRServerExecutionBridge({
    state,
    ledger: stepLedger,
    interactivePlayerChoices: irCtx.interactivePlayerChoices ?? true,
    haltState: transitionHaltState,
  });
  const deferOptionalLookChoices = gameId !== 'unknown'
    && !(ctx as any).isReplaying
    && (
      Boolean((ctx as any).io)
      || isOracleIrTriggerPrimaryEnabled()
      || irCtx.interactivePlayerChoices !== false
    );
  const deferOptionalGrantGraveyardChoices = deferOptionalLookChoices;
  const deferOptionalPerPlayerChoices = deferOptionalLookChoices;

  const result = applyOracleIRStepsToGameState(state, adjustedSteps, {
    ...irCtx,
    stepLedger,
    appliedStepKinds,
    transitionHaltState,
    interactivePlayerChoices: irCtx.interactivePlayerChoices ?? true,
    deferOptionalLookChoices,
    deferOptionalGrantGraveyardChoices,
    deferOptionalPerPlayerChoices,
    deferStackSpellCopiesToServer: true,
    serverBridge,
  }, {
    ...options,
    haltOnPlayerChoiceRequired: options.haltOnPlayerChoiceRequired ?? true,
  });
  Object.assign(state, result.state);
  try {
    const counterSpellApplied = (result.appliedSteps || []).some((step) => step?.kind === 'counter_spell');
    if (counterSpellApplied && !(ctx as any).isReplaying) {
      const stackAfterIds = new Set(
        (Array.isArray((state as any).stack) ? (state as any).stack : [])
          .map((item: any) => String(item?.id || '').trim())
          .filter(Boolean),
      );
      for (const before of stackBeforeCounter) {
        if (!before.id || stackAfterIds.has(before.id)) continue;
        const wasSpell = !before.type || before.type === 'spell';
        if (!wasSpell) continue;
        processSpellCounteredTriggers(ctx, {
          counteringControllerId: String(controller || ''),
          counteredControllerId: before.controller,
          counteredStackItemId: before.id,
          counteredCardName: before.cardName,
          counteringSourceName: String(irCtx.sourceName || '').trim() || 'Counter',
          counteredWasSpell: true,
        });
      }
    }
  } catch {
    // best-effort — do not fail IR resolution for trigger emission
  }
  try {
    emitTriggersAfterOracleIRApply(ctx, state, result, triggerEmissionBefore, {
      controller: String(controller || ''),
    });
  } catch {
    // best-effort — do not fail IR resolution for trigger emission
  }
  syncGraveyardCastFreeExilePermissionsFromOracleIR(state, adjustedSteps, result, irCtx);
  mirrorGraveyardCastingPermissionsToDurable(state);
  syncCastingModifierGrantsFromOracleIRResult(
    state,
    controller,
    String(irCtx.sourceName || '').trim() || undefined,
    result,
    params?.triggerItem ?? params?.sourceItem,
  );
  queueOracleIrDeferredReplacementPrompts(ctx, transitionHaltState, {
    controller: String(controller),
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    continuationSteps: result.pendingContinuationSteps,
  });
  enrichBattlefieldTokenImages(state);
  syncDerivedContinuousEffects(state);
  syncCounterReplacementEffectsAfterOracleIR(ctx, state, countersBefore);
  syncAllOracleIRPlayerZonesAfterResolution(ctx);
  syncImpulseExilePlayPermissionsToState(state);
  bridgeScheduleDelayedFlickerReturnsFromOracleIRResult(ctx, state, result, exileBefore, {
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  bridgeScheduleDelayedDrawAtNextUpkeepFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  const resolutionQueueStepsBefore = gameId && gameId !== 'unknown' && !(ctx as any).isReplaying
    ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
    : 0;
  const queueOracleIrResolutionPrompts = () => {
  const resolutionTriggerItem = params?.triggerItem ?? params?.sourceItem;
  queueTopLibraryChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueSacrificeChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    targetPlayerId: params?.targetPlayerId,
    triggerItem: resolutionTriggerItem,
  });
  queueUnlessPayChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueDiscardChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  syncIrPendingDiscardFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    irCtx,
  });
  queueConniveChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueAddManaChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueAddCounterTargetSelectionPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueCounterDistributionPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueEachPlayerCounterPlacementPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
  });
  bridgeGameStateOracleEffectsAfterOracleIR(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
    effectText: String(params?.oracleText || adjustedSteps.map((step) => String((step as any).raw || '')).filter(Boolean).join(' ')),
  });
  bridgeCreatedTokenEtbTriggersAfterOracleIR(ctx, state, result);
  queuePlayerChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueVotePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueMoveZoneChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueMoveZoneDestinationChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueChooseOneImpulseExilePlayPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  queueOptionalStepChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueEachPlayerMayPutLandFromHandPromptsFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
  });
  queueControllerMayPutLandFromHandPromptsFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
  });
  queueBothPlayersMayPutPermanentFromHandPromptsFromOracleIRResult(ctx, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    triggerItem: resolutionTriggerItem,
    irCtx,
  });
  queueProliferateChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueFlipCoinLifeStakesPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueRedistributeLifeTotalsPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueBlightChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queuePopulateChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueExploreChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueLookChooseChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueSearchLibraryChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    sourceItem: (params as any)?.sourceItem,
  });
  queueChoosePileChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueChangeTargetChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueTapOrUntapChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueTapMatchingPermanentsChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    triggerItem: resolutionTriggerItem,
  });
  queueRepeatedZoneDraftChoicePromptFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueSeparateIntoPilesPromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  bridgeLibraryChaosExchangeFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    sourceItem: resolutionTriggerItem,
  });
  queueCopyPermanentChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueCopySpellStackPushFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
    sourceItem: params?.sourceItem ?? resolutionTriggerItem,
    oracleText: params?.oracleText,
  });
  };
  if (gameId && gameId !== 'unknown' && !(ctx as any).isReplaying) {
    ResolutionQueueManager.runWithDeferredStepAddedEvents(gameId, queueOracleIrResolutionPrompts);
  } else {
    queueOracleIrResolutionPrompts();
  }
  const resolutionQueueStepsAfter = gameId && gameId !== 'unknown' && !(ctx as any).isReplaying
    ? (ResolutionQueueManager.getQueue(gameId).steps?.length ?? 0)
    : resolutionQueueStepsBefore;
  persistUnqueuedPendingContinuationFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    resolutionQueueStepsBefore,
    resolutionQueueStepsAfter,
  });
  syncPreparedCopiesAfterBattlefieldControllerChanges(state, controllersBefore);
  syncPreparedCopiesFromControlChangeEffects(state);
  resyncPreparedExileCopiesWithControllers(state);
  syncIrTemporaryGrantEffectsToServerTemporaryAbilities(
    state,
    String(irCtx.sourceName || '').trim() || 'Ability',
  );
  syncIrPowerToughnessModifiersToTemporaryPTMods(
    state,
    String(irCtx.sourceName || '').trim() || 'Ability',
  );
  syncIrImpulseExileToPendingImpulseDraws(
    state,
    result,
    String(irCtx.sourceName || '').trim() || 'Ability',
  );
  syncIrAtNextEndStepTokenSacrificeFromOracleIRResult(state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  syncIrReanimationRidersFromOracleIRResult(state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
  syncIrPreparedStateFromOracleIRResult(state, result, irCtx);
  syncIrCopyTokenProvenanceFromOracleIRResult(state, result, irCtx);
  syncIrLinkedExilesFromOracleIRResult(ctx, state, result, irCtx);
  syncIrGraveyardExilesToSourcePermanentExiledCards(
    state,
    result,
    graveyardBefore,
    exileBefore,
    irCtx,
    params,
  );
  if (!(ctx as any).isReplaying) {
    persistCounterDiffsFromOracleIR(ctx, countersBefore, state, {
      sourceId: String(irCtx.sourceId || '').trim() || undefined,
      sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
      ...(params?.compoundResume ? { compoundResume: true } : {}),
    });
    persistBattlefieldPermanentPatchesFromOracleIR(ctx, permanentPatchesBefore, state, {
      sourceId: String(irCtx.sourceId || '').trim() || undefined,
      sourceName: String(irCtx.sourceName || '').trim() || undefined,
      ...(params?.compoundResume ? { compoundResume: true } : {}),
    });
    persistOracleIrReplayMutationsFromExecution(ctx, result, {
      sourceId: String(irCtx.sourceId || '').trim() || undefined,
      sourceName: String(irCtx.sourceName || '').trim() || undefined,
      ...(params?.compoundResume ? { compoundResume: true } : {}),
    });
  }
  return result;
}

function findCardsMovedFromGraveyardToExile(
  state: any,
  graveyardBefore: Map<string, Set<string>>,
  exileBefore: Map<string, Set<string>>,
): Array<{ ownerId: PlayerID; card: any }> {
  const moved: Array<{ ownerId: PlayerID; card: any }> = [];
  const zones = state.zones || {};

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const wasInGraveyard = graveyardBefore.get(playerId) || new Set<string>();
    const beforeExile = exileBefore.get(playerId) || new Set<string>();
    const exile = Array.isArray(zones[playerId]?.exile)
      ? zones[playerId].exile
      : Array.isArray(player?.exile)
        ? player.exile
        : [];

    for (const card of exile) {
      const cardId = String(card?.id || '').trim();
      if (!cardId) continue;
      if (wasInGraveyard.has(cardId) && !beforeExile.has(cardId)) {
        moved.push({ ownerId: playerId as PlayerID, card });
      }
    }
  }

  return moved;
}

function oracleIrResultExiledFromGraveyard(result: OracleIRExecutionResult): boolean {
  return (result.appliedSteps || []).some((step) => {
    if (step.kind === 'exile') {
      const targetZone = String((step as any).target?.zone || (step as any).from || '').toLowerCase();
      const selectorText = String((step as any).selector || (step as any).what?.text || '').toLowerCase();
      return targetZone.includes('graveyard') || selectorText.includes('graveyard');
    }
    if (step.kind === 'move_zone') {
      const from = String((step as any).from || '').toLowerCase();
      const to = String((step as any).to || '').toLowerCase();
      const whatText = String((step as any).what?.text || (step as any).what || '').toLowerCase();
      return to === 'exile' && (from.includes('graveyard') || whatText.includes('graveyard'));
    }
    return false;
  });
}

function syncIrGraveyardExilesToSourcePermanentExiledCards(
  state: any,
  result: OracleIRExecutionResult,
  graveyardBefore: Map<string, Set<string>>,
  exileBefore: Map<string, Set<string>>,
  irCtx: OracleIRExecutionContext,
  params?: {
    triggerItem?: any;
    sourceItem?: any;
  },
): void {
  if (!oracleIrResultExiledFromGraveyard(result)) return;

  const sourcePermanentId = String(
    irCtx.sourceId
    || params?.sourceItem?.permanentId
    || params?.sourceItem?.source
    || params?.triggerItem?.permanentId
    || params?.triggerItem?.source
    || '',
  ).trim();
  if (!sourcePermanentId) return;

  const battlefield = Array.isArray(state.battlefield) ? state.battlefield : [];
  const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '') === sourcePermanentId);
  if (!sourcePermanent) return;

  const movedCards = findCardsMovedFromGraveyardToExile(state, graveyardBefore, exileBefore);
  if (movedCards.length === 0) return;

  (sourcePermanent as any).exiledCards = Array.isArray((sourcePermanent as any).exiledCards)
    ? (sourcePermanent as any).exiledCards
    : [];

  for (const { card } of movedCards) {
    const cardId = String(card?.id || '').trim();
    if (!cardId) continue;
    if ((sourcePermanent as any).exiledCards.some((entry: any) => String(entry?.id || '') === cardId)) {
      continue;
    }
    (sourcePermanent as any).exiledCards.push({
      ...card,
      zone: 'exile',
      exiledWith: sourcePermanentId,
    });
  }
}

function syncIrCopyTokenProvenanceFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  const copyStepApplied = (result.appliedSteps || []).some(
    (step) =>
      step.kind === 'create_token'
      && /copy of target creature/i.test(String((step as { token?: string }).token || '')),
  );
  if (!copyStepApplied) return;

  const preferredIds = [
    String(irCtx.targetPermanentId || '').trim(),
    String(irCtx.targetCreatureId || '').trim(),
    String(irCtx.selectorContext?.targetPermanentId || '').trim(),
    ...(Array.isArray(irCtx.selectorContext?.chosenObjectIds)
      ? irCtx.selectorContext.chosenObjectIds.map((id: unknown) => String(id || '').trim())
      : []),
  ].filter(Boolean);

  const sourceId = preferredIds.find((id) =>
    (state.battlefield || []).some(
      (perm: any) => String(perm?.id || '').trim() === id && perm?.isToken !== true,
    ),
  );
  if (!sourceId) return;

  for (const perm of state.battlefield || []) {
    if (!perm?.isToken || perm.copiedFromPermanentId) continue;
    perm.copiedFromPermanentId = sourceId;
    const sourcePermanent = (state.battlefield || []).find(
      (entry: any) => String(entry?.id || '').trim() === sourceId,
    );
    if (sourcePermanent) {
      copyAsEntersCopiableChoicesFromSource(sourcePermanent, perm);
      const creatureType = String(perm.chosenCreatureType || '').trim();
      if (creatureType && String(perm?.card?.name || perm?.name || '').toLowerCase().includes('morophon')) {
        const morophonChosenType = (state.morophonChosenType || {}) as Record<string, string>;
        morophonChosenType[String(perm.id || '')] = creatureType;
        state.morophonChosenType = morophonChosenType;
      }
    }
    break;
  }
}

function resolvePreparedStateGrantTargets(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'grant_static_ability' }>,
  irCtx: OracleIRExecutionContext,
): any[] {
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const targetText = String((step.target as any)?.text || '').trim().toLowerCase();
  const sourceId = String(irCtx.sourceId || (irCtx as any).sourcePermanentId || '').trim();

  if ((targetText === 'this creature' || targetText === 'this permanent' || targetText === 'it') && sourceId) {
    const sourcePermanent = battlefield.find((perm: any) => String(perm?.id || '').trim() === sourceId);
    return sourcePermanent ? [sourcePermanent] : [];
  }

  return [];
}

function syncIrPreparedStateFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  const appliedSteps = result.appliedSteps || [];
  const appliedPreparedGrant = appliedSteps.some((step) => {
    if (step.kind !== 'grant_static_ability') return false;
    const grantedText = [
      ...(Array.isArray((step as any).effectText) ? (step as any).effectText : []),
      ...(Array.isArray((step as any).abilities) ? (step as any).abilities : []),
    ]
      .map((entry: unknown) => String(entry || '').trim().toLowerCase())
      .join(' ');
    return grantedText.includes('becomes prepared') || grantedText.includes('becomes unprepared');
  });

  if (appliedPreparedGrant) {
    for (const step of appliedSteps) {
      if (step.kind !== 'grant_static_ability') continue;
      const grantedText = [
        ...(Array.isArray((step as any).effectText) ? (step as any).effectText : []),
        ...(Array.isArray((step as any).abilities) ? (step as any).abilities : []),
      ]
        .map((entry: unknown) => String(entry || '').trim().toLowerCase())
        .join(' ');
      const becomesPrepared = grantedText.includes('becomes prepared');
      const becomesUnprepared = grantedText.includes('becomes unprepared');
      if (!becomesPrepared && !becomesUnprepared) continue;

      for (const permanent of resolvePreparedStateGrantTargets(state, step as any, irCtx)) {
        if (becomesUnprepared) {
          clearPreparedPermanent(state, permanent);
        } else {
          setPermanentPrepared(state, permanent);
        }
      }
    }
    return;
  }

  for (const perm of state.battlefield || []) {
    const granted = (Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [])
      .map((ability: unknown) => String(ability || '').trim().toLowerCase());
    if (granted.includes('becomes unprepared')) {
      clearPreparedPermanent(state, perm);
      continue;
    }
    if (granted.includes('becomes prepared') && perm.prepared !== true) {
      setPermanentPrepared(state, perm);
    }
  }
}

function findExiledCardForLinkedExileRegistration(
  state: any,
  cardRef: string,
): { card: any; ownerId: string; controllerId: string } | null {
  const normalizedRef = String(cardRef || '').trim();
  if (!normalizedRef) return null;

  const zones = (state as any).zones || {};
  for (const [playerId, zone] of Object.entries(zones)) {
    const exile = Array.isArray((zone as any)?.exile) ? (zone as any).exile : [];
    const found = exile.find((card: any) => {
      const id = String(card?.id || '').trim();
      const name = String(card?.name || '').trim();
      return (
        id === normalizedRef ||
        name === normalizedRef ||
        id === `${normalizedRef}_card` ||
        (normalizedRef.endsWith('_card') && id === normalizedRef.slice(0, -5))
      );
    });
    if (!found) continue;
    return {
      card: found,
      ownerId: String(found?.owner || found?.ownerId || playerId),
      controllerId: String(found?.controller || found?.controllerId || playerId),
    };
  }

  return null;
}

function syncIrLinkedExilesFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  irCtx: OracleIRExecutionContext,
): void {
  const appliedSteps = result.appliedSteps || [];
  const hasLinkedExileStep = appliedSteps.some((step) => {
    if (step.kind !== 'exile') return false;
    const raw = String((step as any).raw || '').trim();
    const targetText = String((step.target as any)?.text || '').trim();
    return /until\b.+\bleaves the battlefield/i.test(`${raw} ${targetText}`);
  });
  if (!hasLinkedExileStep) return;

  const exilingPermanentId = String(irCtx.sourceId || '').trim();
  if (!exilingPermanentId) return;

  const exilingPermanent = (state.battlefield || []).find(
    (perm: any) => String(perm?.id || '').trim() === exilingPermanentId,
  );
  const exilingPermanentName =
    String(irCtx.sourceName || '').trim() ||
    String(exilingPermanent?.card?.name || '').trim() ||
    'Linked Exile Source';

  const targetIds = Array.from(new Set(
    [
      ...(Array.isArray(irCtx.selectorContext?.chosenObjectIds) ? irCtx.selectorContext.chosenObjectIds : []),
      String(irCtx.targetCreatureId || '').trim(),
      String(irCtx.targetPermanentId || '').trim(),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  ));

  state.linkedExiles = Array.isArray(state.linkedExiles) ? state.linkedExiles : [];

  for (const targetId of targetIds) {
    const alreadyRegistered = state.linkedExiles.some((entry: any) =>
      String(entry?.exilingPermanentId || '') === exilingPermanentId &&
      (
        String(entry?.exiledCardId || '') === targetId ||
        String(entry?.exiledCardName || '').trim() === targetId
      ),
    );
    if (alreadyRegistered) continue;

    const located = findExiledCardForLinkedExileRegistration(state, targetId);
    if (!located) continue;

    registerLinkedExile(
      ctx,
      exilingPermanentId,
      exilingPermanentName,
      located.card,
      located.ownerId,
      located.controllerId,
    );
  }
}

function syncIrReanimationRidersFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  params: { controller: PlayerID; sourceName: string },
): void {
  const appliedSteps = result.appliedSteps || [];
  const appliedKinds = new Set(appliedSteps.map((step) => step.kind));
  const hasReanimationBridge =
    appliedKinds.has('move_zone')
    || appliedKinds.has('grant_temporary_ability')
    || appliedKinds.has('grant_static_ability')
    || appliedKinds.has('grant_leave_battlefield_replacement')
    || appliedKinds.has('schedule_delayed_battlefield_action');

  if (!hasReanimationBridge) return;

  for (const perm of state.battlefield || []) {
    if (!perm || typeof perm !== 'object') continue;

    const granted = (Array.isArray(perm.grantedAbilities) ? perm.grantedAbilities : [])
      .map((ability: unknown) => String(ability || '').trim().toLowerCase());
    if (granted.includes('haste')) {
      perm.summoningSickness = false;
    }

    const leaveReplacement = String(perm.leaveBattlefieldReplacement || perm.leaveBattlefieldReplacementDestination || '').trim().toLowerCase();
    if (leaveReplacement === 'exile') {
      perm.leaveBattlefieldReplacementDestination = 'exile';
      if (params.sourceName) {
        perm.leaveBattlefieldReplacementSourceName = params.sourceName;
      }
      perm.card = {
        ...(perm.card || {}),
        leaveBattlefieldReplacementDestination: 'exile',
        ...(params.sourceName ? { leaveBattlefieldReplacementSourceName: params.sourceName } : {}),
      };
    }
  }

  if (!appliedKinds.has('schedule_delayed_battlefield_action')) return;

  const registry = state.delayedTriggerRegistry as { triggers?: Record<string, unknown> } | undefined;
  const triggers = registry?.triggers ? Object.values(registry.triggers) : [];
  if (triggers.length === 0) return;

  state.pendingExileAtNextEndStep = Array.isArray(state.pendingExileAtNextEndStep)
    ? state.pendingExileAtNextEndStep
    : [];

  const fireAtTurnNumber = getNextEndStepFireTurnNumber(state);

  for (const delayed of triggers) {
    const effect = String((delayed as any)?.effect || '').toLowerCase();
    if (!effect.includes('exile')) continue;

    const timing = String((delayed as any)?.timing || '').toUpperCase();
    if (!timing.includes('END_STEP')) continue;

    const targetIds = Array.isArray((delayed as any)?.targets)
      ? (delayed as any).targets.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];

    for (const permanentId of targetIds) {
      const alreadyScheduled = (state.pendingExileAtNextEndStep as any[]).some(
        (entry: any) => String(entry?.permanentId || '').trim() === permanentId,
      );
      if (alreadyScheduled) continue;

      state.pendingExileAtNextEndStep.push({
        permanentId,
        fireAtTurnNumber,
        sourceName: params.sourceName,
        createdBy: String(params.controller),
      });
    }
  }
}

function syncIrAtNextEndStepTokenSacrificeFromOracleIRResult(
  state: any,
  result: OracleIRExecutionResult,
  params: { controller: PlayerID; sourceName: string },
): void {
  const scheduledSacrifice = (result.appliedSteps || []).some(
    (step) => step.kind === 'create_token' && (step as { atNextEndStep?: string }).atNextEndStep === 'sacrifice',
  );
  if (!scheduledSacrifice) return;

  const registry = state.delayedTriggerRegistry as { triggers?: Record<string, unknown> } | undefined;
  const triggers = registry?.triggers ? Object.values(registry.triggers) : [];
  if (triggers.length === 0) return;

  state.pendingSacrificeAtNextEndStep = Array.isArray(state.pendingSacrificeAtNextEndStep)
    ? state.pendingSacrificeAtNextEndStep
    : [];

  const fireAtTurnNumber = getNextEndStepFireTurnNumber(state);

  for (const delayed of triggers) {
    const effect = String((delayed as any)?.effect || '');
    if (!/sacrifice (?:that|those) tokens?\.?/i.test(effect)) continue;

    const timing = String((delayed as any)?.timing || '').toUpperCase();
    if (!timing.includes('END_STEP')) continue;

    const targetIds = Array.isArray((delayed as any)?.targets)
      ? (delayed as any).targets.map((id: unknown) => String(id || '').trim()).filter(Boolean)
      : [];
    for (const permanentId of targetIds) {
      const alreadyScheduled = (state.pendingSacrificeAtNextEndStep as any[]).some(
        (entry: any) => String(entry?.permanentId || '').trim() === permanentId,
      );
      if (alreadyScheduled) continue;

      state.pendingSacrificeAtNextEndStep.push({
        permanentId,
        fireAtTurnNumber,
        maxManaValue: 0,
        sourceName: params.sourceName,
        createdBy: String(params.controller),
      });
    }
  }
}

function syncIrImpulseExileToPendingImpulseDraws(
  state: any,
  result: OracleIRExecutionResult,
  sourceName: string,
): void {
  const hadImpulseExile = (result.appliedSteps || []).some((step) => step.kind === 'impulse_exile_top');
  if (!hadImpulseExile) return;

  state.pendingImpulseDraws = state.pendingImpulseDraws || {};

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const playableMap = state.playableFromExile?.[playerId];
    if (!playableMap || typeof playableMap !== 'object') continue;

    const exileCards = [
      ...(Array.isArray(state.zones?.[playerId]?.exile) ? state.zones[playerId].exile : []),
      ...(Array.isArray(player?.exile) ? player.exile : []),
    ];

    state.pendingImpulseDraws[playerId] = state.pendingImpulseDraws[playerId] || [];

    for (const card of exileCards) {
      const cardId = String(card?.id || '').trim();
      if (!cardId || playableMap[cardId] === undefined) continue;

      const playableUntilTurn = Number(card?.playableUntilTurn ?? playableMap[cardId]);
      if (!Number.isFinite(playableUntilTurn)) continue;

      const alreadyQueued = state.pendingImpulseDraws[playerId].some(
        (entry: any) => String(entry?.cardId || '') === cardId,
      );
      if (alreadyQueued) continue;

      state.pendingImpulseDraws[playerId].push({
        cardId,
        cardName: card?.name,
        exiledBy: card?.exiledBy || sourceName,
        playableUntilTurn,
      });
    }
  }
}

function normalizeTemporaryAbilityKeyForSync(ability: string): string {
  return String(ability || '')
    .toLowerCase()
    .replace(/\s+this turn/g, '')
    .trim();
}

function preferTemporaryAbilityText(existing: string, candidate: string): string {
  const left = String(existing || '').trim();
  const right = String(candidate || '').trim();
  if (!left) return right;
  if (!right) return left;
  if (/\bthis turn\b/i.test(left) && !/\bthis turn\b/i.test(right)) return left;
  if (/\bthis turn\b/i.test(right) && !/\bthis turn\b/i.test(left)) return right;
  return left.length >= right.length ? left : right;
}

function canonicalizeTemporaryAbilityForServer(abilityText: string, expiresAt: string): string {
  const text = String(abilityText || '').trim();
  if (!text) return text;
  if (expiresAt !== 'end_of_turn' && expiresAt !== 'end_of_combat') return text;
  if (/\bthis turn\b/i.test(text)) return text;
  if (/can't be blocked by creatures with power \d+ or less$/i.test(text)) {
    return `${text} this turn`;
  }
  if (/^prevent all combat damage that would be dealt to this creature$/i.test(text)) {
    return `${text} this turn`;
  }
  return text;
}

function syncIrTemporaryGrantEffectsToServerTemporaryAbilities(
  state: any,
  sourceName: string,
): void {
  const turnNumber = Number(state?.turnNumber || 0);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;

    const pendingAbilities: string[] = [];
    const temporaryEffects = Array.isArray(perm.temporaryEffects) ? perm.temporaryEffects : [];
    for (const effect of temporaryEffects) {
      if (!effect || typeof effect !== 'object') continue;
      const expiresAt = String(effect.expiresAt || '').trim();
      if (expiresAt && expiresAt !== 'end_of_turn' && expiresAt !== 'end_of_combat') continue;

      const description = String(effect.description || '').trim();
      if (description) {
        pendingAbilities.push(description);
        continue;
      }

      const effectGranted = Array.isArray(effect.grantedAbilities) ? effect.grantedAbilities : [];
      for (const ability of effectGranted) {
        const text = String(ability || '').trim();
        if (text) pendingAbilities.push(text);
      }
    }

    if (pendingAbilities.length === 0) continue;

    perm.temporaryAbilities = Array.isArray(perm.temporaryAbilities) ? perm.temporaryAbilities : [];
    for (const abilityText of pendingAbilities) {
      const canonicalAbility = canonicalizeTemporaryAbilityForServer(abilityText, 'end_of_turn');
      const key = normalizeTemporaryAbilityKeyForSync(canonicalAbility);
      const existingIndex = perm.temporaryAbilities.findIndex((entry: any) =>
        normalizeTemporaryAbilityKeyForSync(String(entry?.ability || entry || '')) === key
        && String(entry?.source || sourceName) === String(sourceName)
        && String(entry?.expiresAt || 'end_of_turn') === 'end_of_turn'
      );
      if (existingIndex >= 0) {
        const existingAbility = String(perm.temporaryAbilities[existingIndex]?.ability || '').trim();
        const merged = preferTemporaryAbilityText(existingAbility, canonicalAbility);
        if (merged !== existingAbility) {
          perm.temporaryAbilities[existingIndex] = {
            ...perm.temporaryAbilities[existingIndex],
            ability: merged,
          };
        }
        continue;
      }

      perm.temporaryAbilities.push({
        ability: canonicalAbility,
        source: sourceName,
        expiresAt: 'end_of_turn',
        turnApplied: turnNumber,
      });
    }
  }
}

function syncIrPowerToughnessModifiersToTemporaryPTMods(
  state: any,
  sourceName: string,
): void {
  const turnNumber = Number(state?.turnNumber || 0);
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  for (const perm of battlefield) {
    if (!perm || typeof perm !== 'object') continue;
    const modifiers = Array.isArray(perm.modifiers) ? perm.modifiers : [];
    if (modifiers.length === 0) continue;

    perm.temporaryPTMods = Array.isArray(perm.temporaryPTMods) ? perm.temporaryPTMods : [];
    for (const modifier of modifiers) {
      if (String(modifier?.type || '').trim() !== 'powerToughness') continue;
      const duration = String(modifier?.duration || 'end_of_turn').trim();
      if (duration !== 'end_of_turn') continue;

      const power = Number(modifier?.power ?? 0);
      const toughness = Number(modifier?.toughness ?? 0);
      // Use the modifier's own identity. Using the currently resolving effect's
      // source name here caused every later Oracle IR resolution to mirror old
      // modifiers again under a new source (for example, stacking Overkill's
      // -0/-9999 repeatedly).
      const modifierSource = String(
        modifier?.sourceId
        || modifier?.sourceName
        || sourceName,
      ).trim();
      const duplicate = perm.temporaryPTMods.some((entry: any) =>
        Number(entry?.power ?? 0) === power
        && Number(entry?.toughness ?? 0) === toughness
        && String(entry?.source || '') === modifierSource
        && String(entry?.expiresAt || 'end_of_turn') === 'end_of_turn'
        && Number(entry?.turnApplied ?? turnNumber) === turnNumber
      );
      if (duplicate) continue;

      perm.temporaryPTMods.push({
        power,
        toughness,
        source: modifierSource,
        expiresAt: 'end_of_turn',
        turnApplied: turnNumber,
      });
    }
  }
}
