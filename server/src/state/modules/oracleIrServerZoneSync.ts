import type { PlayerID } from '../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../rules-engine/src/oracleIR.js';
import {
  applyOracleIRStepsToGameState,
  buildOracleIRExecutionContext,
  type OracleIRExecutionContext,
  type OracleIRExecutionOptions,
  type OracleIRExecutionResult,
} from '../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveOracleQuantity } from '../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import { resolvePlayers } from '../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { buildSacrificeTargetSelectionOptions } from '../../../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import {
  buildDiscardSelectionOptions,
  buildExploreDecisionFromStep,
  buildLookChooseFromTopSelectionOptions,
  buildLookSelectTopSelectionOptions,
} from '../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { getProliferateChoiceTargets, buildPopulateTargetSelectionOptions } from '../../../../rules-engine/src/oracleIRExecutorKeywordStepHandlers.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { applyMillReplacements } from './game-state-effects.js';
import { processMillTriggers } from './zones.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';

/**
 * The live server stores libraries in ctx.libraries and zone summaries in state.zones,
 * while rules-engine Oracle IR reads/writes player.library on state.players.
 * Hydrate before IR execution and sync back afterward.
 */
export function hydrateOracleIRPlayerZonesFromContext(ctx: GameContext, state: any): void {
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

export function syncOracleIRPlayerZonesToContext(
  ctx: GameContext,
  state: any,
  controller: PlayerID,
  graveyardBefore: Map<string, Set<string>>,
): void {
  const libraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  if (!libraries || typeof libraries.set !== 'function') return;

  const zones = state.zones = state.zones || {};
  let changed = false;

  for (const player of state.players || []) {
    const playerId = String(player?.id || '').trim();
    if (!playerId) continue;

    const playerZones = zones[playerId] = zones[playerId] || {
      hand: [],
      handCount: 0,
      graveyard: [],
      graveyardCount: 0,
      exile: [],
      exileCount: 0,
      libraryCount: 0,
    };

    if (Array.isArray(player.library)) {
      libraries.set(playerId as PlayerID, [...player.library]);
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

    if (Array.isArray(player.hand)) {
      playerZones.hand = [...player.hand];
      playerZones.handCount = player.hand.length;
      changed = true;
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
      const count = resolveOracleQuantity(
        state,
        params.controller,
        (step as any).amount as OracleQuantity,
        params.irCtx,
        playerId,
        { whereX: (step as any).whereX }
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

    const built = buildDiscardSelectionOptions(state, step, params.irCtx);
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
    chosenObjectIds: readonly string[];
    targetPlayerId?: PlayerID;
    targetSpellId?: string;
  },
): OracleIRExecutionResult | null {
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    return null;
  }

  const chosenObjectIds = params.chosenObjectIds
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  if (chosenObjectIds.length === 0) {
    return null;
  }

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      selectorContext: { chosenObjectIds },
    },
    {
      targetPlayerId: params.targetPlayerId,
      targetSpellId: params.targetSpellId,
      chosenObjectIds,
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

  const rawSelections = response.selections;
  const chosenObjectIds = Array.isArray(rawSelections)
    ? rawSelections.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  return resumeOracleIRStepWithChoiceFromResolution(ctx, {
    controller: String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID,
    sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
    sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
    steps: choiceSteps,
    chosenObjectIds,
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
  queueProliferateChoicePromptsFromOracleIRResult(ctx, state, result, {
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
  return result;
}
