import type { PlayerID } from '../../../../../shared/src/types.js';
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from '../index.js';
import { debugWarn } from '../../../utils/debug.js';

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

function ensureFinalizedMap(state: any): Record<string, true> {
  state.kynaiosFinalizedBatches = state.kynaiosFinalizedBatches || {};
  return state.kynaiosFinalizedBatches as Record<string, true>;
}

function maybeFinalizeKynaiosBatch(
  io: any,
  game: any,
  gameId: string,
  batchId: string,
  sourceController: PlayerID,
  sourceName: string,
  getPlayerName: (game: any, playerId: PlayerID) => string
): void {
  const state = game?.state as any;
  if (!state) return;

  const finalized = ensureFinalizedMap(state);
  if (finalized[batchId]) return;

  const queue = ResolutionQueueManager.getQueue(gameId);

  const hasRemaining = queue.steps.some(
    (s: any) => s && s.type === ResolutionStepType.KYNAIOS_CHOICE && String((s as any).kynaiosBatchId || '') === batchId
  );
  if (hasRemaining) return;

  const batchSteps = queue.completedSteps.filter(
    (s: any) => s && s.type === ResolutionStepType.KYNAIOS_CHOICE && String((s as any).kynaiosBatchId || '') === batchId
  );

  let drew = 0;
  state.pendingDraws = state.pendingDraws || {};

  for (const step of batchSteps) {
    const pid = step.playerId as PlayerID;
    if (!pid) continue;
    if (pid === sourceController) continue; // "each opponent who didn't" only

    const { choice } = parseKynaiosChoice(step?.response?.selections);
    const playedLand = choice === 'play_land';
    if (playedLand) continue;

    state.pendingDraws[pid] = (state.pendingDraws[pid] || 0) + 1;
    drew++;
    emitChat(io, gameId, `${getPlayerName(game, pid)} draws a card (${sourceName}).`);
  }

  finalized[batchId] = true;
  if (drew === 0) {
    emitChat(io, gameId, `${sourceName}: No opponents drew a card.`);
  }
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
  const isController = stepData.isController || false;
  const sourceController = (stepData.sourceController || pid) as PlayerID;
  const sourceName = step.sourceName || 'Kynaios and Tiro of Meletis';
  const canPlayLand = stepData.canPlayLand !== false;
  const landsInHand = stepData.landsInHand || [];
  const options = stepData.options || ['play_land', 'draw_card', 'decline'];
  const batchId = String(stepData.kynaiosBatchId || step.id);

  if (!options.includes(choice as any)) {
    debugWarn(1, `[Resolution] Invalid Kynaios choice: ${choice} not in allowed options`);
    return;
  }

  if (choice === 'play_land') {
    if (!landCardId) {
      debugWarn(1, `[Resolution] Kynaios: missing landCardId for play_land`);
      return;
    }
    if (!canPlayLand) {
      debugWarn(1, `[Resolution] Kynaios: player ${pid} cannot play land`);
      return;
    }
    const isValidLand = landsInHand.some((land: any) => land.id === landCardId);
    if (!isValidLand) {
      debugWarn(1, `[Resolution] Invalid Kynaios land choice: ${landCardId} not in hand`);
      return;
    }

    const zones = game.state?.zones?.[pid];
    if (zones?.hand) {
      const cardIndex = zones.hand.findIndex((c: any) => c.id === landCardId);
      if (cardIndex !== -1) {
        const [card] = zones.hand.splice(cardIndex, 1);
        const cardName = card?.name || 'a land';

        const permanentId = `perm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const permanent = {
          id: permanentId,
          controller: pid,
          owner: pid,
          tapped: false,
          counters: {},
          card: { ...card, zone: 'battlefield' },
        };

        game.state.battlefield = game.state.battlefield || [];
        game.state.battlefield.push(permanent);

        zones.handCount = zones.hand.length;

        emitChat(io, gameId, `${deps.getPlayerName(game, pid)} puts ${cardName} onto the battlefield (${sourceName}).`);
      }
    }
  } else {
    // Do NOT draw immediately; draws happen only after all players have made their land-drop choice.
    if (!isController) {
      emitChat(io, gameId, `${deps.getPlayerName(game, pid)} chooses not to put a land onto the battlefield (${sourceName}).`);
    } else {
      emitChat(io, gameId, `${deps.getPlayerName(game, pid)} declines to put a land onto the battlefield (${sourceName}).`);
    }
  }

  maybeFinalizeKynaiosBatch(io, game, gameId, batchId, sourceController, sourceName, deps.getPlayerName);
}
