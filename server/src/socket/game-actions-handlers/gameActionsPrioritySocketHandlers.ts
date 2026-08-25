/**
 * Origin parent: server/src/socket/game-actions.ts
 *
 * Cluster moved: the registerGameActions socket handlers for passPriority
 * and resolveAllTriggers, plus the nested checkAndEmitDamageTriggers helper
 * those handlers close over.
 *
 * These were arrow bodies inside registerGameActions. They take io/socket and
 * the room guard explicitly; registerGameActions now just registers them.
 *
 * Public entry symbols: handlePassPriorityRequest, handleResolveAllTriggersRequest.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { tryQueueMoxDiamondBeforeStackResolve } from "../../state/modules/mox-diamond-choice.js";
import { isSpellEffectOwnedByOracleIrPrimary } from "../../state/modules/oracleIrSpellLegacyRouting.js";
import {
  canResumePendingPhaseSkip,
  resumePendingPhaseSkip,
} from "../../state/modules/phaseSkipUtils.js";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import type { InMemoryGame } from "../../state/types";
import { debug, debugError } from "../../utils/debug.js";
import { emitPendingDamageTriggers } from "../damage-triggers.js";
import { detectTutorEffect, parseSearchCriteria } from "../interaction";
import { filterLibraryCardsForSearch } from "../library-search.js";
import {
  processPendingBottomOrder,
  processPendingCascades,
  processPendingDanceWithCalamity,
  processPendingLimDulsVault,
  processPendingOracleIrCompoundResume,
  processPendingPonder,
  processPendingProliferate,
  processPendingScry,
  processPendingSurveil,
} from "../resolution.js";
import { advanceStepPersistingEvent } from "../step-advance.js";
import {
  appendGameEvent,
  broadcastGame,
  clearHumanAutoPassPauseOnAction,
  ensureGame,
  getPlayerName,
  persistAndResolveTopOfStack,
} from "../util";
import {
  checkColorChoiceForNewPermanents,
  checkCreatureTypeSelectionForNewPermanents,
  checkEnchantmentETBTriggers,
  checkPlayerSelectionForNewPermanents,
} from "./gameActionsPermanentEntryPrompts.js";
import { processOracleIRInteractions } from "./gameActionsSpellCastLock.js";
import type { EnsureInGameRoom } from "./gameActionsSocketRoomGuard.js";

// Pass priority
export async function handlePassPriorityRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown; isAutoPass?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  const isAutoPass = payload?.isAutoPass;

  if (!gameId || typeof gameId !== 'string') return;

  try {
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (socketIsSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Spectators can't pass priority." } as any);
      return;
    }

    const players = ((game.state as any)?.players || []) as any[];
    const me = players.find((p: any) => p?.id === playerId);
    if (!me || me?.spectator || me?.isSpectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized." } as any);
      return;
    }

    const { changed, resolvedNow, advanceStep } = (game as any).passPriority(playerId, isAutoPass === true);
    if (!changed) return;

    if (isAutoPass !== true) {
      clearHumanAutoPassPauseOnAction(game as any, playerId, 'passPriority');
    }

    appendGameEvent(game, gameId, "passPriority", { by: playerId });

    let suppressAdvanceStepAfterPhaseSkip = false;

    const tryResumePendingPhaseSkipAfterPass = (): void => {
      if (!canResumePendingPhaseSkip(game, gameId)) {
        return;
      }
      const phaseSkipResume = resumePendingPhaseSkip({
        game,
        gameId,
        io,
        playerId: String((game.state as any).pendingPhaseSkip?.requestedBy || playerId || ''),
        turnPlayer: String(game.state?.turnPlayer || ''),
        targetPhase: String((game.state as any).pendingPhaseSkip?.targetPhase || ''),
        targetStep: String((game.state as any).pendingPhaseSkip?.targetStep || ''),
        logPrefix: '[passPriority]',
      });
      if (phaseSkipResume === 'stopped' || phaseSkipResume === 'completed' || phaseSkipResume === 'blocked') {
        broadcastGame(io, game, gameId);
        if (phaseSkipResume === 'stopped' || phaseSkipResume === 'completed') {
          suppressAdvanceStepAfterPhaseSkip = true;
        }
      }
    };

    if (resolvedNow) {
      // Capture the top spell before it resolves (for tutor effect handling)
      const stackBefore = game.state?.stack || [];
      const topItem = stackBefore.length > 0 ? stackBefore[stackBefore.length - 1] : null;
      const resolvedCard = topItem?.card;
      const resolvedController = topItem?.controller;
      
      if (tryQueueMoxDiamondBeforeStackResolve(game)) {
        if (typeof game.bumpSeq === 'function') {
          game.bumpSeq();
        }
        broadcastGame(io, game, gameId);
        return;
      }
      
      
      // Append-first so as-enters prompts / ETB pushes are logged after resolveTopOfStack.
      if (persistAndResolveTopOfStack(game, gameId)) {
        debug(2, `[passPriority] Stack resolved for game ${gameId}`);

        // Queue prompts for any "you may" oracle IR effects on the resolved spell
        await processOracleIRInteractions(io, game, gameId, topItem);

        // Check for creature type selection requirements on newly entered permanents
        // (e.g., Morophon, Cavern of Souls, Kindred Discovery)
        checkCreatureTypeSelectionForNewPermanents(io, game, gameId);
        
        // Check for color choice requirements on newly entered permanents
        // (e.g., Caged Sun, Gauntlet of Power)
        checkColorChoiceForNewPermanents(io, game, gameId);
        
        // Check for player selection requirements on newly entered permanents
        // (e.g., Stuffy Doll, Vislor Turlough, Xantcha)
        checkPlayerSelectionForNewPermanents(io, game, gameId);
        
        // Check for enchantment ETB triggers (e.g., Growing Rites of Itlimoc)
        checkEnchantmentETBTriggers(io, game, gameId);
        
        // Check if the resolved spell has a tutor effect (search library)
        if (resolvedCard && resolvedController) {
          const oracleText = resolvedCard.oracle_text || '';
          const typeLine = (resolvedCard.type_line || '').toLowerCase();
          const isInstantOrSorcery = typeLine.includes('instant') || typeLine.includes('sorcery');
          
          if (isInstantOrSorcery && oracleText.toLowerCase().includes('search your library')) {
            // Use the comprehensive tutor detection function
            const tutorInfo = detectTutorEffect(oracleText);
            
            if (tutorInfo.isTutor) {
              const cardName = resolvedCard.name || 'Spell';

              if (isSpellEffectOwnedByOracleIrPrimary(oracleText, cardName)) {
                debug(2, `[passPriority] Skipping legacy library search for ${cardName} (Oracle IR primary owns effect)`);
              } else {
              
              // Parse search criteria for filter
              const filter = parseSearchCriteria(tutorInfo.searchCriteria || '');
              
              // Get library for the spell's controller
              const library = typeof game.searchLibrary === 'function' 
                ? game.searchLibrary(resolvedController, "", 1000) 
                : [];
              
              // Find the socket for the controller and send library search request
              for (const s of io.sockets.sockets.values()) {
                if (s.data?.playerId === resolvedController && !(s.data as any)?.spectator && !(s.data as any)?.isSpectator) {
                  // Queue library search via Resolution Queue
                  const isSplit = tutorInfo.splitDestination === true;
                  const destination: any = isSplit
                    ? 'split'
                    : (tutorInfo.destination === 'battlefield' || tutorInfo.destination === 'battlefield_tapped') ? 'battlefield'
                    : (tutorInfo.destination === 'exile') ? 'exile'
                    : 'hand';
                  ResolutionQueueManager.addStep(gameId, {
                    type: ResolutionStepType.LIBRARY_SEARCH,
                    playerId: resolvedController as PlayerID,
                    sourceName: cardName,
                    description: tutorInfo.searchCriteria ? `Search for: ${tutorInfo.searchCriteria}` : 'Search your library',
                    searchCriteria: tutorInfo.searchCriteria || 'any card',
                    minSelections: 0,
                    maxSelections: tutorInfo.maxSelections || (isSplit ? 2 : 1),
                    mandatory: false,
                    destination,
                    reveal: false,
                    shuffleAfter: true,
                    availableCards: filterLibraryCardsForSearch(library, filter, game.state, resolvedController),
                    filter,
                    splitDestination: isSplit,
                    toBattlefield: tutorInfo.toBattlefield || 1,
                    toHand: tutorInfo.toHand || 1,
                    entersTapped: tutorInfo.entersTapped || false,
                  } as any);
                  break;
                }
              }
              
              debug(2, `[passPriority] Triggered library search for ${cardName} by ${resolvedController} (destination: ${tutorInfo.splitDestination ? 'split' : tutorInfo.destination})`);
              }
            }
          }
        }
      }
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: "Top of stack resolved.",
        ts: Date.now(),
      });
      
      // Process any cascade triggers
      await processPendingCascades(io, game, gameId);
      
      // Process any pending scry effects
      processPendingScry(io, game, gameId);

      // Process any pending surveil effects
      processPendingSurveil(io, game, gameId);
      
      // Process any pending ponder effects
      processPendingPonder(io, game, gameId);

      // Process any pending bottom-order effects
      processPendingBottomOrder(io, game, gameId);

      // Process any pending Lim-Dul's Vault effects
      processPendingLimDulsVault(io, game, gameId);

      // Process any pending Dance with Calamity effects
      processPendingDanceWithCalamity(io, game, gameId);
      
      // Process any pending proliferate effects
      processPendingProliferate(io, game, gameId);
      processPendingOracleIrCompoundResume(io, game, gameId);
      
      // Resume pending phase skip incrementally after intermediate trigger stops resolve.
      tryResumePendingPhaseSkipAfterPass();
    } else if ((game.state as any).pendingPhaseSkip) {
      // Stack already empty (e.g. trigger order finished) � continue pending skip without resolving.
      tryResumePendingPhaseSkipAfterPass();
    }

    // If all players passed priority with empty stack, advance to next step
    if (advanceStep && !suppressAdvanceStepAfterPhaseSkip) {
      if (advanceStepPersistingEvent(io, game as any, gameId, { reason: 'allPlayersPassed' })) {
        debug(2, `[passPriority] All players passed priority - advanced to next step for game ${gameId}`);
        
        const newStep = (game.state as any)?.step || 'unknown';
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `Step advanced to ${newStep}.`,
          ts: Date.now(),
        });
      }
    }

    broadcastGame(io, game, gameId);
    
    // Check for pending damage triggers (Brash Taunter, Boros Reckoner, etc.)
    // These are queued during combat damage or spell resolution
    checkAndEmitDamageTriggers(io, game, gameId);
  } catch (err: any) {
    debugError(1, `passPriority error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "PASS_PRIORITY_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

/**
 * Check for pending damage triggers and emit them to the appropriate players.
 * This is now primarily a compatibility fallback for any legacy or replay-restored
 * pendingDamageTriggers state that still needs to be converted into Resolution Queue steps.
 */
function checkAndEmitDamageTriggers(io: Server, game: InMemoryGame, gameId: string) {
  emitPendingDamageTriggers(io, game, gameId);
}

/**
 * Batch resolve all triggered abilities on the stack.
 * This is a convenience feature that resolves all triggers without pausing for priority
 * between each one. Only works when:
 * 1. The player has priority
 * 2. All stack items are triggered abilities controlled by the player
 */
export async function handleResolveAllTriggersRequest(
  io: Server,
  socket: Socket,
  ensureInGameRoom: EnsureInGameRoom,
  payload?: { gameId?: unknown },
): Promise<void> {
  const gameId = payload?.gameId;
  try {
    if (!gameId || typeof gameId !== 'string') return;
    const game = ensureGame(gameId);
    const playerId = socket.data.playerId;
    if (!game || !playerId) return;

    if (!ensureInGameRoom(gameId)) return;

    const state = game.state;
    if (!state || state.priority !== playerId) {
      socket.emit("error", { code: "NOT_PRIORITY", message: "You don't have priority" });
      return;
    }

    const stack = state.stack || [];
    if (stack.length === 0) {
      socket.emit("error", { code: "EMPTY_STACK", message: "Stack is empty" });
      return;
    }

    // Verify all items are triggered abilities controlled by this player
    const allMyTriggers = stack.every((item: any) => 
      item.type === 'triggered_ability' && item.controller === playerId
    );

    if (!allMyTriggers) {
      socket.emit("error", { 
        code: "MIXED_STACK", 
        message: "Cannot batch resolve - stack contains items not controlled by you or non-triggers" 
      });
      return;
    }

    debug(2, `[resolveAllTriggers] Batch resolving ${stack.length} triggers for ${playerId}`);

    // Track which sources we're resolving for client count updates
    const resolvedSources: Map<string, { sourceName: string; count: number; effect: string; imageUrl?: string }> = new Map();
    for (const item of stack) {
      const sourceKey = (item as any).source || (item as any).sourceId || (item as any).sourceName;
      const sourceName = (item as any).sourceName || 'Unknown';
      const effect = (item as any).description || '';
      const imageUrl = (item as any).card?.image_uris?.small;
      
      const existing = resolvedSources.get(sourceKey);
      if (existing) {
        existing.count++;
      } else {
        resolvedSources.set(sourceKey, { sourceName, count: 1, effect, imageUrl });
      }
    }

    // Resolve all triggers in sequence (top to bottom)
    let resolvedCount = 0;
    while (state.stack && state.stack.length > 0) {
      if (typeof (game as any).resolveTopOfStack === 'function') {
        (game as any).resolveTopOfStack();
        resolvedCount++;
      } else {
        break;
      }
    }

    // Log the batch resolution
    appendGameEvent(game, gameId, "resolveAllTriggers", { 
      by: playerId, 
      count: resolvedCount 
    });

    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} resolved ${resolvedCount} triggered abilities.`,
      ts: Date.now(),
    });

    // Emit summary of resolved sources so client can update auto-resolve counts
    const resolvedSourcesArray = Array.from(resolvedSources.entries()).map(([key, value]) => ({
      sourceKey: key,
      ...value,
    }));
    socket.emit("triggersResolved", {
      gameId,
      playerId,
      totalCount: resolvedCount,
      sources: resolvedSourcesArray,
    });

    // After batch resolution, priority goes back to the active player
    state.priority = state.turnPlayer as PlayerID;
    
    if (typeof game.bumpSeq === 'function') {
      game.bumpSeq();
    }

    broadcastGame(io, game, gameId);
  } catch (err: any) {
    debugError(1, `resolveAllTriggers error for game ${gameId}:`, err);
    socket.emit("error", {
      code: "RESOLVE_ALL_ERROR",
      message: err?.message ?? String(err),
    });
  }
}

