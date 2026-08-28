import type { Server } from 'socket.io';
import { appendEvent } from '../db';
import { broadcastGame, getPlayerName } from './util.js';
import { appendGameEvent } from './util-handlers/appendGameEvent.js';
import { ResolutionQueueManager } from '../state/resolution/ResolutionQueueManager.js';
import { ResolutionStepType } from '../state/resolution/types.js';
import { flushPendingDamageTriggersAfterStepAdvance } from './step-advance.js';
import { debug, debugError, debugWarn } from '../utils/debug.js';

const PREGAME_RESOLUTION_STEP_TYPES = new Set<string>([
  ResolutionStepType.OPENING_HAND_ACTIONS,
  ResolutionStepType.HAND_TO_BOTTOM,
]);

function isPreGamePhase(game: any): boolean {
  const phaseStr = String(game.state?.phase || '').toUpperCase().trim();
  return phaseStr === '' || phaseStr === 'PRE_GAME' || phaseStr.includes('PRE');
}

function getActivePlayers(game: any): any[] {
  return (game.state?.players || []).filter(
    (p: any) => p && !p.spectator && !p.isSpectator
  );
}

function allPlayersHaveDecks(game: any): boolean {
  const zones = game.state?.zones || {};
  for (const player of getActivePlayers(game)) {
    const playerZones = zones[player.id];
    const libraryCount = playerZones?.libraryCount ?? 0;
    const handCount = playerZones?.handCount ?? 0;
    if (libraryCount === 0 && handCount === 0) {
      return false;
    }
  }
  return getActivePlayers(game).length > 0;
}

function allPlayersKeptHands(game: any): boolean {
  const mulliganState = (game.state as any)?.mulliganState || {};
  for (const player of getActivePlayers(game)) {
    const playerId = player.id;
    const playerMulliganState = mulliganState[playerId];
    if (!playerMulliganState?.hasKeptHand) {
      return false;
    }
    if (Number(playerMulliganState.pendingBottomCount || 0) > 0) {
      return false;
    }
  }
  return getActivePlayers(game).length > 0;
}

function hasPendingPreGameResolutionSteps(gameId: string): boolean {
  try {
    const queue = ResolutionQueueManager.getQueue(gameId);
    return (queue?.steps || []).some(
      (step: any) => step && PREGAME_RESOLUTION_STEP_TYPES.has(String(step.type || ''))
    );
  } catch {
    return true;
  }
}

function shuffleCopy<T>(items: T[]): T[] {
  const next = items.slice();
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = next[i];
    next[i] = next[j];
    next[j] = tmp;
  }
  return next;
}

/**
 * Persist a shuffled pre-game seating / turn order. Replay applies the same
 * permutation via `randomizeStartingPlayer` + `playerOrder`.
 */
export function randomizeAndPersistPregameTurnOrder(
  game: any,
  gameId: string,
  by?: string,
): { selectedPlayerId: string; playerOrder: string[] } | null {
  const active = getActivePlayers(game);
  if (active.length === 0) return null;

  const playerOrder = shuffleCopy(active.map((p: any) => String(p?.id || '').trim()).filter(Boolean));
  if (playerOrder.length === 0) return null;

  const selectedPlayerId = playerOrder[0];
  appendGameEvent(game, gameId, 'randomizeStartingPlayer', {
    selectedPlayerId,
    playerOrder,
    by,
  });
  return { selectedPlayerId, playerOrder };
}

function ensureStartingPlayer(game: any): string | null {
  const activePlayers = getActivePlayers(game);
  if (activePlayers.length === 0) return null;

  const existing = String(game.state?.turnPlayer || '').trim();
  if (existing && activePlayers.some((p: any) => p.id === existing)) {
    return existing;
  }

  const firstPlayerId = String(activePlayers[0]?.id || '').trim();
  if (!firstPlayerId) return null;

  game.state.turnPlayer = firstPlayerId;
  if (!(game.state as any).startingPlayerId) {
    (game.state as any).startingPlayerId = firstPlayerId;
    (game.state as any).startingPlayer = firstPlayerId;
  }
  return firstPlayerId;
}

/**
 * Start the game automatically once all pre-game setup is complete:
 * decks loaded, hands kept (including London mulligan bottoming), and opening-hand prompts resolved.
 */
export async function tryAutoStartGameFromPreGame(
  io: Server,
  game: any,
  gameId: string,
  reason: string
): Promise<boolean> {
  try {
    if (!game || !gameId) return false;
    if (!isPreGamePhase(game)) return false;
    if ((game.state as any)?._pregameAutoStartInProgress) return false;

    if (!allPlayersHaveDecks(game)) return false;
    if (!allPlayersKeptHands(game)) return false;
    if (hasPendingPreGameResolutionSteps(gameId)) return false;

    const queueSummary = ResolutionQueueManager.getPendingSummary(gameId);
    if (queueSummary.hasPending) return false;

    if (Array.isArray(game.state?.stack) && game.state.stack.length > 0) {
      return false;
    }

    // Last keep is the official moment to shuffle seating / who goes first.
    // Skip when this start was itself triggered by a manual Random Start click.
    if (reason !== 'randomizeStartingPlayer') {
      randomizeAndPersistPregameTurnOrder(game, gameId);
    }

    const startingPlayerId = ensureStartingPlayer(game);
    if (!startingPlayerId) return false;

    if (typeof game.nextTurn !== 'function') {
      debugError(1, `[pregame-auto-start] game.nextTurn missing for ${gameId}`);
      return false;
    }

    (game.state as any)._pregameAutoStartInProgress = true;

    await game.nextTurn();
    flushPendingDamageTriggersAfterStepAdvance(io, game, gameId);

    try {
      appendEvent(gameId, (game as any).seq ?? 0, 'nextTurn', {
        reason,
        autoStart: true,
        startingPlayerId,
      });
    } catch (err) {
      debugWarn(1, '[pregame-auto-start] appendEvent(nextTurn) failed:', err);
    }

    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: `Game started! ${getPlayerName(game, startingPlayerId)} goes first.`,
      ts: Date.now(),
    });

    broadcastGame(io, game, gameId);
    debug(2, `[pregame-auto-start] Started game ${gameId} (${reason}) — first player ${startingPlayerId}`);
    return true;
  } catch (err) {
    debugError(1, `[pregame-auto-start] Failed for game ${gameId}:`, err);
    return false;
  } finally {
    try {
      delete (game.state as any)?._pregameAutoStartInProgress;
    } catch {
      /* ignore */
    }
  }
}
