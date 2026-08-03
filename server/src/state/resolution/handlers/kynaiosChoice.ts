import type { PlayerID } from '../../../../../shared/src/types.js';
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from '../index.js';
import { appendEvent } from '../../../db/index.js';
import { debugWarn } from '../../../utils/debug.js';
import { applyCounterModifications } from '../../modules/counters_tokens.js';
import { detectEntersWithCounters } from '../../modules/detectEntersWithCounters.js';
import { checkPermanentEntersTapped } from '../../modules/triggerPermanentEntersTapped.js';
import { queueSelfETBTriggersForPermanent } from '../../modules/triggerEtbEntryEffects.js';
import { triggerETBEffectsForPermanent } from '../../modules/triggerEtbPermanentEffects.js';
import { runPostResolutionPermanentPromptChecks } from '../../../socket/game-actions.js';
import { broadcastGame } from '../../../socket/util.js';

function drawKynaiosCard(game: any, playerId: PlayerID): void {
  if (typeof game?.drawCards === 'function') {
    game.drawCards(playerId, 1);
    return;
  }

  const zones = game?.state?.zones?.[playerId];
  if (!zones || !Array.isArray(zones.library)) return;

  const drawnCard = zones.library.shift();
  if (!drawnCard) return;

  zones.hand = Array.isArray(zones.hand) ? zones.hand : [];
  zones.hand.push({ ...drawnCard, zone: 'hand' });
  zones.handCount = zones.hand.length;
  zones.libraryCount = zones.library.length;
}

function parseKynaiosChoice(selection: any): { choice: string; landCardId?: string } {
  if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    return { choice: String((selection as any).choice || 'decline'), landCardId: (selection as any).landCardId };
  }
  if (Array.isArray(selection) && selection.length > 0) {
    return { choice: String(selection[0] ?? 'decline'), landCardId: selection[1] ? String(selection[1]) : undefined };
  }
  return { choice: String(selection || 'decline') };
}

function emitChat(io: any, gameId: string, message: string): void {
  try {
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message,
      ts: Date.now(),
    });
  } catch {
    // best-effort
  }
}

function emitToPlayerSafe(io: any, playerId: PlayerID, event: string, payload: unknown): void {
  try {
    const sockets = io?.sockets?.sockets;
    if (sockets && typeof sockets.values === 'function') {
      for (const socket of sockets.values()) {
        if (String(socket?.data?.playerId || '') === String(playerId)) {
          socket.emit(event, payload);
        }
      }
      return;
    }
    if (typeof io?.to === 'function') {
      io.to(String(playerId)).emit(event, payload);
    }
  } catch {
    // best-effort
  }
}

function ensureFinalizedMap(state: any): Record<string, true> {
  state.kynaiosFinalizedBatches = state.kynaiosFinalizedBatches || {};
  return state.kynaiosFinalizedBatches as Record<string, true>;
}

export function moveKynaiosLandFromHandToBattlefield(
  game: any,
  playerId: PlayerID,
  landCardId: string,
  createdPermanentId?: string,
  options?: {
    triggerEtb?: boolean;
    gameId?: string;
  }
): { moved: boolean; permanentId?: string; cardName?: string } {
  const zones = game?.state?.zones?.[playerId];
  if (!zones?.hand || !Array.isArray(zones.hand)) {
    return { moved: false };
  }

  const cardIndex = zones.hand.findIndex((card: any) => String(card?.id || '') === String(landCardId));
  if (cardIndex === -1) {
    return { moved: false };
  }

  const [card] = zones.hand.splice(cardIndex, 1);
  const battlefield = Array.isArray(game.state.battlefield) ? game.state.battlefield : [];
  const permanentId = String(createdPermanentId || `perm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`);
  const entersTapped = checkPermanentEntersTapped(battlefield, playerId, card);
  const initialCounters = detectEntersWithCounters(card);
  const modifiedCounters = applyCounterModifications(game.state, permanentId, initialCounters || {});
  const permanent = {
    id: permanentId,
    controller: playerId,
    owner: playerId,
    tapped: entersTapped,
    counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : {},
    card: { ...card, zone: 'battlefield' },
  };

  battlefield.push(permanent);
  game.state.battlefield = battlefield;
  zones.handCount = zones.hand.length;

  if (options?.triggerEtb) {
    queueSelfETBTriggersForPermanent(
      {
        state: game.state,
        gameId: options.gameId,
        libraries: game.libraries,
        players: game.state?.players,
      } as any,
      permanent,
      playerId,
    );

    triggerETBEffectsForPermanent(
      {
        state: game.state,
        gameId: options.gameId,
        libraries: game.libraries,
        players: game.state?.players,
      } as any,
      permanent,
      playerId,
      false
    );
  }

  return {
    moved: true,
    permanentId,
    cardName: card?.name || 'a land',
  };
}

function maybeFinalizeKynaiosBatch(
  io: any,
  game: any,
  gameId: string,
  batchId: string,
  sourceController: PlayerID,
  sourceName: string,
  getPlayerName: (game: any, playerId: PlayerID) => string
): string[] | null {
  const state = game?.state as any;
  if (!state) return null;

  const finalized = ensureFinalizedMap(state);
  if (finalized[batchId]) return null;

  const queue = ResolutionQueueManager.getQueue(gameId);

  const hasRemaining = queue.steps.some(
    (s: any) => s && s.type === ResolutionStepType.KYNAIOS_CHOICE && String((s as any).kynaiosBatchId || '') === batchId
  );
  if (hasRemaining) return null;

  const batchSteps = queue.completedSteps.filter(
    (s: any) => s && s.type === ResolutionStepType.KYNAIOS_CHOICE && String((s as any).kynaiosBatchId || '') === batchId
  );

  let drew = 0;
  const drawnPlayerIds: string[] = [];

  for (const step of batchSteps) {
    const pid = step.playerId as PlayerID;
    if (!pid) continue;
    if (pid === sourceController) continue; // "each opponent who didn't" only

    const { choice } = parseKynaiosChoice(step?.response?.selections);
    const playedLand = choice === 'play_land';
    if (playedLand) continue;

    drawKynaiosCard(game, pid);
    drew++;
    drawnPlayerIds.push(String(pid));
    emitChat(io, gameId, `${getPlayerName(game, pid)} draws a card (${sourceName}).`);
  }

  finalized[batchId] = true;
  if (drew === 0) {
    emitChat(io, gameId, `${sourceName}: No opponents drew a card.`);
  }

  return drawnPlayerIds;
}

/**
 * Handle Kynaios and Tiro style choice response.
 * IMPORTANT: Per Oracle text, opponents draw only *after* all players have had the chance
 * to put a land onto the battlefield (the "then" clause). We therefore finalize draws
 * only when the last step in the batch completes.
 */
export function handleKynaiosChoiceResponse(
  io: any,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
  deps: { readonly getPlayerName: (game: any, playerId: PlayerID) => string }
): void {
  const pid = response.playerId as PlayerID;
  const { choice, landCardId } = parseKynaiosChoice(response.selections);

  const stepData = step as any;
  const isController = stepData.landPlayOrFallbackIsController ?? stepData.isController ?? false;
  const sourceController = (stepData.landPlayOrFallbackSourceController || stepData.sourceController || pid) as PlayerID;
  const sourceName = step.sourceName || 'Kynaios and Tiro of Meletis';
  const canPlayLand = (stepData.landPlayOrFallbackCanPlayLand ?? stepData.canPlayLand) !== false;
  const landsInHand = stepData.landPlayOrFallbackLandsInHand || stepData.landsInHand || [];
  const options = stepData.landPlayOrFallbackOptions || stepData.options || ['play_land', 'draw_card', 'decline'];
  const batchId = String(stepData.kynaiosBatchId || step.id);
  const skipFinalize = stepData.landPlayOrFallbackSkipFinalize === true;
  let createdPermanentId: string | undefined;

  if (!options.includes(choice as any)) {
    debugWarn(1, `[Resolution] Invalid Kynaios choice: ${choice} not in allowed options`);
    return;
  }

  if (choice === 'play_land') {
    const normalizedLandCardId = String(landCardId || '').trim();
    if (!normalizedLandCardId) {
      debugWarn(1, `[Resolution] Kynaios: missing landCardId for play_land`);
      emitToPlayerSafe(io, pid, 'error', { code: 'INVALID_SELECTION', message: 'Missing land selection' });
      return;
    }
    if (!canPlayLand) {
      debugWarn(1, `[Resolution] Kynaios: player ${pid} cannot play land`);
      emitToPlayerSafe(io, pid, 'error', { code: 'INVALID_SELECTION', message: 'You cannot play a land' });
      return;
    }
    const liveHandLands = Array.isArray(game?.state?.zones?.[pid]?.hand)
      ? (game.state.zones[pid].hand as any[]).filter((card: any) =>
        card && String(card?.type_line || '').toLowerCase().includes('land'))
      : [];
    const allowedIds = new Set([
      ...landsInHand.map((land: any) => String(land?.id || '').trim()).filter(Boolean),
      ...liveHandLands.map((land: any) => String(land?.id || '').trim()).filter(Boolean),
    ]);
    if (!allowedIds.has(normalizedLandCardId)) {
      debugWarn(1, `[Resolution] Invalid Kynaios land choice: ${normalizedLandCardId} not in hand`);
      emitToPlayerSafe(io, pid, 'error', { code: 'INVALID_SELECTION', message: 'Selected land is not a valid choice' });
      return;
    }

    const moveResult = moveKynaiosLandFromHandToBattlefield(game, pid, normalizedLandCardId, undefined, {
      triggerEtb: true,
      gameId,
    });
    if (!moveResult.moved) {
      debugWarn(1, `[Resolution] Failed to move Kynaios land choice ${normalizedLandCardId} for ${pid}`);
      emitToPlayerSafe(io, pid, 'error', {
        code: 'LAND_MOVE_FAILED',
        message: 'Could not put that land onto the battlefield — it may no longer be in your hand.',
      });
      return;
    }
    createdPermanentId = moveResult.permanentId;
    emitChat(io, gameId, `${deps.getPlayerName(game, pid)} puts ${moveResult.cardName || 'a land'} onto the battlefield (${sourceName}).`);
    runPostResolutionPermanentPromptChecks(io, game, gameId);
    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }
    broadcastGame(io, game, gameId);
  } else if (choice === 'draw_card' && skipFinalize && isController) {
    drawKynaiosCard(game, pid);
    emitChat(io, gameId, `${deps.getPlayerName(game, pid)} draws a card (${sourceName}).`);
  } else {
    // Do NOT draw immediately; draws happen only after all players have made their land-drop choice.
    if (!isController) {
      emitChat(io, gameId, `${deps.getPlayerName(game, pid)} chooses not to put a land onto the battlefield (${sourceName}).`);
    } else {
      emitChat(io, gameId, `${deps.getPlayerName(game, pid)} declines to put a land onto the battlefield (${sourceName}).`);
    }
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'kynaiosChoiceResponse', {
      stepId: String((step as any).id || ''),
      resolvedStepId: String((step as any).id || ''),
      batchId,
      playerId: pid,
      sourceController,
      sourceName,
      choice,
      landCardId: landCardId ? String(landCardId) : undefined,
      createdPermanentId,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(kynaiosChoiceResponse) failed:', err);
  }

  if (!skipFinalize) {
    const drawnPlayerIds = maybeFinalizeKynaiosBatch(io, game, gameId, batchId, sourceController, sourceName, deps.getPlayerName);
    if (drawnPlayerIds) {
      try {
        appendEvent(gameId, (game as any).seq ?? 0, 'kynaiosChoiceComplete', {
          batchId,
          sourceController,
          sourceName,
          drawnPlayerIds,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] appendEvent(kynaiosChoiceComplete) failed:', err);
      }
    }
  }
}
