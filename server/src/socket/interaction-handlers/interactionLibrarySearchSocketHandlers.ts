/**
 * Origin parent: server/src/socket/interaction.ts
 *
 * Cluster moved: library-search restriction helpers (Aven Mindcensor /
 * Stranglehold) plus the requestLibrarySearch socket handler.
 *
 * Public entry symbols: handleLibrarySearchRequest.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { evaluateLibrarySearchReplacementEvent } from "../../state/modules/replacement-effects.js";
import { ensureGame, getPlayerName } from "../util";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";

// ============================================================================
// Library Search Restriction Handling (Aven Mindcensor, Stranglehold, etc.)
// ============================================================================

/**
 * Check for search restrictions affecting a player
 */
function checkLibrarySearchRestrictions(
  game: any,
  searchingPlayerId: string
): {
  canSearch: boolean;
  limitToTop?: number;
  triggerEffects: { cardName: string; effect: string; controllerId: string }[];
  controlledBy?: string;
  reason?: string;
  paymentRequired?: { cardName: string; amount: string };
} {
  const result = evaluateLibrarySearchReplacementEvent({ game, searchingPlayerId });
  const metadata = (result.metadata || {}) as any;
  
  return {
    canSearch: metadata.canSearch !== false,
    limitToTop: typeof metadata.limitToTop === 'number' ? metadata.limitToTop : undefined,
    triggerEffects: Array.isArray(metadata.triggerEffects) ? metadata.triggerEffects : [],
    controlledBy: metadata.controlledBy,
    reason: metadata.reason,
    paymentRequired: metadata.paymentRequired,
  };
}

/**
 * Get searchable library cards considering Aven Mindcensor effect
 */
function getSearchableLibraryCards(library: any[], limitToTop?: number): any[] {
  if (limitToTop !== undefined && limitToTop > 0) {
    return library.slice(0, limitToTop);
  }
  return library;
}

// Request full library for searching (tutor effect)
export async function handleLibrarySearchRequest(
  io: Server,
  socket: Socket,
  payload?: {
    gameId?: unknown;
    title?: unknown;
    description?: unknown;
    filter?: any;
    maxSelections?: unknown;
    moveTo?: unknown;
    shuffleAfter?: unknown;
  },
): Promise<void> {
    const gameId = payload?.gameId;
    const title = payload?.title;
    const description = payload?.description;
    const filter = (payload as any)?.filter;
    const maxSelections = payload?.maxSelections;
    const moveTo = payload?.moveTo;
    const shuffleAfter = payload?.shuffleAfter;
  const pid = socket.data.playerId as string | undefined;
  const socketIsSpectator = !!(
    (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
  );
  if (!pid || socketIsSpectator) return;

  if (!gameId || typeof gameId !== 'string') return;
  if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !(socket as any)?.rooms?.has?.(gameId)) {
    socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
    return;
  }

  const game = ensureGame(gameId);
  try {
    const seated = Array.isArray((game.state as any)?.players)
      ? (game.state as any).players.some((p: any) => p?.id === pid && !p?.spectator && !p?.isSpectator)
      : false;
    if (!seated) {
      socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
      return;
    }
  } catch {
    socket.emit?.('error', { code: 'NOT_IN_GAME', message: 'Not in game.' });
    return;
  }
  
  // Check for search restrictions (Aven Mindcensor, Stranglehold, etc.)
  const searchCheck = checkLibrarySearchRestrictions(game, pid);
  
  // If search is completely prevented
  if (!searchCheck.canSearch) {
    socket.emit("error", {
      code: "SEARCH_PREVENTED",
      message: searchCheck.reason || "Library search is prevented",
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)}'s library search was prevented${searchCheck.reason ? ': ' + searchCheck.reason : ''}.`,
      ts: Date.now(),
    });
    return;
  }
  
  // Get library contents (may be limited by Aven Mindcensor)
  const fullLibrary = game.searchLibrary(pid, "", 1000);
  const searchableCards = getSearchableLibraryCards(fullLibrary, searchCheck.limitToTop);
  
  // If there are trigger effects (Ob Nixilis), notify
  if (searchCheck.triggerEffects.length > 0) {
    for (const trigger of searchCheck.triggerEffects) {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${trigger.cardName} triggers: ${trigger.effect}`,
        ts: Date.now(),
      });
      
      // Note: Trigger resolution (e.g., Ob Nixilis forcing sacrifice/life loss)
      // would require pushing to the stack and resolving. For now, we notify
      // the players via chat. Full implementation would use the stack system.
    }
  }
  
  // Build description with restriction info
  let finalDescription = description || "";
  if (searchCheck.limitToTop) {
    finalDescription = `${finalDescription ? finalDescription + " " : ""}(Searching top ${searchCheck.limitToTop} cards only - Aven Mindcensor)`;
  }
  if (searchCheck.paymentRequired) {
    finalDescription = `${finalDescription ? finalDescription + " " : ""}(Must pay ${searchCheck.paymentRequired.amount} to ${searchCheck.paymentRequired.cardName})`;
  }
  
  // Migrate legacy librarySearchRequest flow to Resolution Queue.
  const moveToStr = String(moveTo || 'hand');
  const entersTapped = moveToStr === 'battlefield_tapped' || moveToStr.endsWith('_tapped');
  const destination: any = moveToStr.startsWith('battlefield') ? 'battlefield'
    : moveToStr === 'graveyard' ? 'graveyard'
    : moveToStr === 'exile' ? 'exile'
    : moveToStr === 'top' ? 'top'
    : moveToStr === 'bottom' ? 'bottom'
    : 'hand';

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: pid as PlayerID,
    sourceName: typeof title === 'string' && title ? title : 'Search Library',
    description: finalDescription || undefined,
    searchCriteria: typeof title === 'string' && title ? title : 'Search your library',
    minSelections: 0,
    maxSelections: typeof maxSelections === 'number' && Number.isFinite(maxSelections) ? maxSelections : 1,
    mandatory: false,
    destination,
    reveal: false,
    shuffleAfter: shuffleAfter !== false,
    availableCards: searchableCards,
    entersTapped,
    filter,
    searchRestrictions: {
      limitedToTop: searchCheck.limitToTop,
      paymentRequired: searchCheck.paymentRequired,
      triggerEffects: searchCheck.triggerEffects,
      controlledBy: searchCheck.controlledBy,
    },
  } as any);
}
