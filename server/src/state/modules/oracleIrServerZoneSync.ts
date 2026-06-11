import type { PlayerID } from '../../../../shared/src/index.js';
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
import { resolvePlayers } from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { buildSacrificeTargetSelectionOptions } from '../../../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import {
  collectDiscardSelectionOptionsForStep,
  buildExploreDecisionFromStep,
  buildLookChooseFromTopSelectionOptions,
  buildLookSelectTopSelectionOptions,
  buildSearchLibrarySelectionOptions,
} from '../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { getProliferateChoiceTargets, buildPopulateTargetSelectionOptions, collectBlightTargetSelectionConfigs } from '../../../../rules-engine/src/oracleIRExecutorKeywordStepHandlers.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { applyMillReplacements } from './game-state-effects.js';
import { processMillTriggers } from './zones.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import {
  applyCopyPermanentTriggerStep,
  copyPermanentTriggerStepNeedsTargetSelectionQueue,
} from './trigger-copy-permanent.js';
import { syncPreparedPermanentAfterControlChange, resyncPreparedExileCopiesWithControllers } from './prepared.js';
import { scheduleExiledCardReturnToBattlefield } from './executeSpellEffect.js';
import { parseSimplePermanentTypeFromText } from '../../../../rules-engine/src/oracleIRExecutorBattlefieldParser.js';
import { hasExecutorClass } from '../../../../rules-engine/src/oracleIRExecutorPermanentUtils.js';
import { getNextEndStepFireTurnNumber } from './triggerDelayedEffectUtils.js';

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
    if (Array.isArray(playerZones.exile)) {
      player.exile = playerZones.exile.map((card: any) => ({ ...card, zone: card?.zone || 'exile' }));
    }
  }
}

export function snapshotGraveyardCardIds(state: any): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;
    const graveyard = Array.isArray(player?.graveyard) ? player.graveyard : [];
    out.set(playerId, new Set(graveyard.map((card: any) => String(card?.id || '')).filter(Boolean)));
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

function isScheduleDelayedBattlefieldReturnStep(
  step: OracleEffectStep,
): step is Extract<OracleEffectStep, { kind: 'schedule_delayed_trigger' }> {
  if (step.kind !== 'schedule_delayed_trigger') return false;
  const effect = String(step.effect || '').toLowerCase();
  return /\breturn\b/.test(effect) && /\bbattlefield\b/.test(effect);
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
      playerZones.handCount = player.hand.length;
      changed = true;
    }

    if (!canSyncLibraries) continue;

    if (Array.isArray(player.library)) {
      libraries.set(playerId as PlayerID, [...player.library]);
      playerZones.library = [...player.library];
      playerZones.libraryCount = player.library.length;
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

    const { finalCount } = applyMillReplacements(ctx, baseCount, String(controller), String(millTarget));
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

function attachOracleIrResumeMetadata(
  payload: Record<string, unknown>,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
  },
): Record<string, unknown> {
  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending.length === 0) {
    return payload;
  }

  return {
    ...payload,
    oracleIrResumeStepsJson: JSON.stringify(pending),
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
    if (gap.reasonCode !== 'player_choice_required') continue;
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
        ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
          type: ResolutionStepType.SCRY,
          playerId,
          description: `${sourceName}: Scry ${actualCount}`,
          mandatory: true,
          sourceId,
          sourceName,
          scryCount: actualCount,
          cards,
        } as any, result, params) as any);
        continue;
      }

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.SURVEIL,
        playerId,
        description: `${sourceName}: Surveil ${actualCount}`,
        mandatory: true,
        sourceId,
        sourceName,
        surveilCount: actualCount,
        cards,
      } as any, result, params) as any);
    }
  }
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
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (gap.reasonCode !== 'player_choice_required') continue;
    if (String(gap.stepKind || '') !== 'sacrifice') continue;

    const step = (result.skippedSteps || []).find(
      (candidate) =>
        candidate.kind === 'sacrifice' &&
        String((candidate as any).raw || '') === String(gap.raw || '')
    ) as OracleEffectStep | undefined;
    if (!step || step.kind !== 'sacrifice') continue;

    const built = buildSacrificeTargetSelectionOptions(state, step, params.irCtx);
    if (!built || built.options.length === 0) continue;

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
    if (gap.reasonCode !== 'player_choice_required') continue;
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

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
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
    if (gap.reasonCode !== 'player_choice_required') continue;
    if (String(gap.stepKind || '') !== 'proliferate') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'proliferate') continue;

    const availableTargets = getProliferateChoiceTargets(state);
    if (availableTargets.length <= 1) continue;

    const choosingPlayerId =
      resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;

    const queueKey = `proliferate:${String((step as any).raw || '')}:${choosingPlayerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    try {
      const existing = ResolutionQueueManager
        .getStepsForPlayer(gameId, choosingPlayerId)
        .find(
          (candidate) =>
            candidate.type === ResolutionStepType.PROLIFERATE &&
            sourceId &&
            String((candidate as any)?.sourceId || '') === sourceId &&
            String((candidate as any)?.description || '').includes(String((step as any).raw || ''))
        );
      if (existing) continue;
    } catch {
      // ignore
    }

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.PROLIFERATE,
      playerId: choosingPlayerId,
      description: `${sourceName}: ${String((step as any).raw || 'Proliferate')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      proliferateId: `${sourceId || sourceName}:${String((step as any).raw || 'proliferate')}`,
      availableTargets: availableTargets.map((target) => ({
        id: target.id,
        name: target.name,
        counters: { ...target.counters },
        isPlayer: target.isPlayer,
        type: target.type,
        ...(target.controller ? { controller: target.controller } : {}),
      })),
    } as any, result, params) as any);
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
    if (gap.reasonCode !== 'player_choice_required') continue;
    if (String(gap.stepKind || '') !== 'explore') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'explore') continue;

    const built = buildExploreDecisionFromStep(state, step, params.irCtx);
    if (!built) continue;

    const queueKey = `explore:${String((step as any).raw || '')}:${built.permanentId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.EXPLORE_DECISION,
      playerId: built.playerId,
      description: `${sourceName}: ${built.permanentName} explores`,
      mandatory: (step as any).optional !== true,
      sourceId: built.permanentId,
      sourceName: built.permanentName,
      permanentId: built.permanentId,
      permanentName: built.permanentName,
      revealedCard: built.revealedCard,
      isLand: built.isLand,
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
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
    if (gap.reasonCode !== 'player_choice_required') continue;
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
    if (gap.reasonCode !== 'player_choice_required') continue;
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
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (gap.reasonCode !== 'player_choice_required') continue;
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

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: built.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Look and choose')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        searchCriteria: String((step as any).raw || 'Look at the top cards of your library'),
        minSelections: built.minSelections,
        maxSelections: built.maxSelections,
        destination: built.destination === 'exile' ? 'exile' : 'hand',
        reveal: Boolean((step as any).reveal),
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder: built.restOrder !== 'any',
        remainderPlayerChoosesOrder: built.restOrder === 'any',
        availableCards,
        nonSelectableCards,
        filter: built.filter,
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
      continue;
    }

    if (step.kind === 'look_select_top') {
      const built = buildLookSelectTopSelectionOptions(state, step, params.irCtx);
      if (!built || built.availableCards.length === 0) continue;

      const queueKey = `look_select:${String((step as any).raw || '')}:${built.playerId}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: built.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Look and select')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        searchCriteria: String((step as any).raw || 'Look at the top cards of your library'),
        minSelections: built.chooseCount,
        maxSelections: built.chooseCount,
        destination: built.destination === 'graveyard' ? 'graveyard' : 'hand',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: built.restDestination === 'graveyard' ? 'graveyard' : built.restToTop ? 'top' : 'bottom',
        remainderRandomOrder: false,
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
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (gap.reasonCode !== 'player_choice_required') continue;
    if (String(gap.stepKind || '') !== 'search_library') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'search_library') continue;

    const built = buildSearchLibrarySelectionOptions(
      state,
      step as Extract<OracleEffectStep, { kind: 'search_library' }>,
      params.irCtx,
    );
    if (!built || built.matches.length === 0) continue;

    const queueKey = `search_library:${String((step as any).raw || '')}:${built.playerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const destination = built.destination === 'battlefield'
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

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: built.playerId,
      description: `${sourceName}: ${String((step as any).raw || 'Search your library')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      searchCriteria: String((step as any).raw || 'Search your library'),
      minSelections: built.minSelections,
      maxSelections: built.maxSelections,
      destination,
      reveal: Boolean((step as any).revealFound),
      shuffleAfter: (step as any).shuffle !== false,
      availableCards: built.matches.map(normalizeTopLibraryPromptCard),
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
    if (gap.reasonCode !== 'player_choice_required') continue;
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
    if (gap.reasonCode !== 'player_choice_required') continue;
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
    playerId,
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
    if (gap.reasonCode !== 'player_choice_required') continue;
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
    if (gap.reasonCode !== 'player_choice_required') continue;
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
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (gap.reasonCode !== 'player_choice_required') continue;
    if (String(gap.stepKind || '') !== 'player_choice') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'player_choice') continue;

    const queueKey = `player_choice:${String((step as any).choice || '')}:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const prompt = buildPlayerChoicePrompt(
      step as Extract<OracleEffectStep, { kind: 'player_choice' }>,
      { controller: params.controller, sourceName, sourceId },
    );
    if (!prompt) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata(prompt, result, params) as any);
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
      && gap.reasonCode !== 'player_choice_required'
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

function queueUnlessPayChoicePromptsFromOracleIRResult(
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
    if (gap.reasonCode !== 'player_choice_required') continue;

    const stepKind = String(gap.stepKind || '');
    const gapRaw = String(gap.raw || '');
    const queueKey = `${stepKind}:${gapRaw}`;
    if (queuedKeys.has(queueKey)) continue;

    const metadata = (gap.metadata || {}) as Record<string, unknown>;
    const unlessPayManaCost = String(metadata.unlessPayManaCost || '').trim();
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
    if (stepKind === 'unless_pays_mana' && skippedStep?.kind === 'unless_pays_mana') {
      const manaCost = String((skippedStep as any).mana || metadata.manaCost || '').trim();
      if (!manaCost) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

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
      } as any, result, params) as any);
    }
  }
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
  },
): OracleIRExecutionResult | null {
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    return null;
  }

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
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

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
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

export function maybeApplyOracleIrChoiceStepFromResolution(
  ctx: GameContext,
  step: any,
  response: { readonly selections?: unknown; readonly cancelled?: boolean },
): OracleIRExecutionResult | null {
  if (response.cancelled) {
    return null;
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
  } else if (firstStep?.kind === 'connive' || firstStep?.kind === 'discard' || firstStep?.kind === 'sacrifice' || firstStep?.kind === 'search_library') {
    if (selectionIds.length === 0) {
      return null;
    }
    chosenObjectIds = selectionIds;
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
    } else {
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
  });
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

  return resumeOracleIRRemainingStepsFromResolution(ctx, {
    controller: String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID,
    sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
    sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
    steps: remainingSteps,
  });
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
  },
): OracleIRExecutionResult {
  hydrateOracleIRPlayerZonesFromContext(ctx, state);
  const graveyardBefore = snapshotGraveyardCardIds(state);
  const exileBefore = snapshotExileCardIds(state);
  const controllersBefore = snapshotBattlefieldControllers(state);

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

  const result = applyOracleIRStepsToGameState(state, adjustedSteps, {
    ...irCtx,
    interactivePlayerChoices: irCtx.interactivePlayerChoices ?? true,
  }, {
    ...options,
    haltOnPlayerChoiceRequired: options.haltOnPlayerChoiceRequired ?? true,
  });
  Object.assign(state, result.state);
  syncOracleIRPlayerZonesToContext(ctx, state, controller, graveyardBefore);
  bridgeScheduleDelayedFlickerReturnsFromOracleIRResult(ctx, state, result, exileBefore, {
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
  });
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
  });
  queueUnlessPayChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
  });
  queueDiscardChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
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
  queuePlayerChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  queueProliferateChoicePromptsFromOracleIRResult(ctx, state, result, {
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
  });
  queueSearchLibraryChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
    irCtx,
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
  queueCopyPermanentChoicePromptsFromOracleIRResult(ctx, state, result, {
    controller,
    sourceName: String(irCtx.sourceName || '').trim() || 'Ability',
    sourceId: String(irCtx.sourceId || '').trim() || undefined,
  });
  syncPreparedCopiesAfterBattlefieldControllerChanges(state, controllersBefore);
  syncPreparedCopiesFromControlChangeEffects(state);
  resyncPreparedExileCopiesWithControllers(state);
  syncIrTemporaryGrantEffectsToServerTemporaryAbilities(
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
  syncIrCopyTokenProvenanceFromOracleIRResult(state, result, irCtx);
  return result;
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
    break;
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
      if (description) pendingAbilities.push(description);

      const effectGranted = Array.isArray(effect.grantedAbilities) ? effect.grantedAbilities : [];
      for (const ability of effectGranted) {
        const text = String(ability || '').trim();
        if (text) pendingAbilities.push(text);
      }
    }

    if (pendingAbilities.length === 0) continue;

    perm.temporaryAbilities = Array.isArray(perm.temporaryAbilities) ? perm.temporaryAbilities : [];
    for (const abilityText of pendingAbilities) {
      const normalized = abilityText.toLowerCase();
      const alreadyPresent = perm.temporaryAbilities.some((entry: any) => {
        const existing = typeof entry === 'string'
          ? String(entry || '').trim().toLowerCase()
          : String(entry?.ability || '').trim().toLowerCase();
        return existing === normalized || existing.includes(normalized) || normalized.includes(existing);
      });
      if (alreadyPresent) continue;

      perm.temporaryAbilities.push({
        ability: abilityText,
        source: sourceName,
        expiresAt: 'end_of_turn',
        turnApplied: turnNumber,
      });
    }
  }
}
