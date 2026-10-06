import type { Server, Socket } from "socket.io";
import * as crypto from "node:crypto";
import {
  parseDecklist,
  validateDeck,
  shouldSkipDeckLine,
  fetchDeckFromMoxfield,
  isMoxfieldUrl,
  parsedDecklistToExpandedString,
} from "../services/scryfall";
import { resolveDeckList, type ResolveDeckListStatus } from "../services/deckImport.js";
import { getPreconDecklistLines } from "../services/bundledPreconDecklists.js";
import { fetchWizardsPreconDecklist } from "../services/wizardsPreconDecklists.js";
import { getPreconWizardsAnnouncementUrl } from "../data/preconWizardsUrls.js";
import { ensureGame, broadcastGame } from "./util";
import { appendEvent } from "../db";
import {
  saveDeck as saveDeckDB,
  getDeck as getDeckDB,
  renameDeck as renameDeckDB,
  deleteDeck as deleteDeckDB,
  updateDeckResolvedCards,
  updateDeckContent as updateDeckContentDB,
  moveDeckToFolder,
  buildFolderTree,
} from "../db/decks";
import { listDecksVisibleTo, canReadDeck, normalizeDeckVisibility } from "../decks/deckAccess.js";
import { attachSocketAuth, getSocketAccountIsAdmin, getSocketAccountUserId } from "../auth/attachSocketAuth.js";
import type { KnownCardRef, PlayerID, GameState } from "../../../shared/src";
import { GamePhase, createCardFromScryfall } from "../../../shared/src";
import { COMMANDER_PRECONS } from "../../../shared/src/precons";

import { ResolutionQueueManager, ResolutionStepType } from "../state/resolution/index.js";

// NEW: helpers to push candidate/suggest events to player's sockets
import { debug, debugWarn, debugError } from "../utils/debug.js";
import {
  emitImportedDeckCandidatesToPlayer,
  emitSuggestCommandersToPlayer,
} from "./commander";
import {
  canModifySavedDeck,
  cancelImportWipeConfirmResolutionSteps,
  isSocketInGameRoom,
  makeImportConfirmId,
  pendingImportConfirmations,
  toImportBufferCard,
} from "./deck-handlers/deckImportConfirmState.js";
import type { PendingConfirm } from "./deck-handlers/deckImportConfirmState.js";
import { applyConfirmedImport } from "./deck-handlers/deckApplyConfirmedImport.js";
import { registerImportDeckHandler } from "./deck-handlers/deckImportDeckSocketHandlers.js";
import { registerImportDeckFromUrlHandler } from "./deck-handlers/deckImportDeckFromUrlSocketHandlers.js";
import { registerImportPreconDeckHandler } from "./deck-handlers/deckImportPreconDeckSocketHandlers.js";
import { registerUseSavedDeckHandler } from "./deck-handlers/deckUseSavedDeckSocketHandlers.js";
import {
  addPendingInitialDrawFlag,
  broadcastConfirmUpdate,
  cancelConfirmation,
  clearPlayerTransientZonesForImport,
  getActivePlayerIds,
  suggestCommanderNames,
} from "./deck-handlers/deckImportConfirmHelpers.js";
import {
  createDeckResolutionStatusReporter,
  enqueueImportWipeConfirmToResolutionQueue,
  generateUniqueCardInstanceId,
  MIN_PRECON_DECK_SIZE,
} from "./deck-handlers/deckImportResolutionSupport.js";

function visibleDecksForSocket(socket: Socket) {
  return listDecksVisibleTo(getSocketAccountUserId(socket), getSocketAccountIsAdmin(socket));
}

export function handleImportWipeConfirmVote(
  io: Server,
  gameId: string,
  confirmId: string,
  voterId: PlayerID,
  accept: boolean
) {
  const pending = pendingImportConfirmations.get(confirmId);
  if (!pending) {
    return;
  }

  if (pending.gameId !== gameId) {
    return;
  }

  if (!(String(voterId) in pending.responses)) {
    return;
  }

  const prev = pending.responses[String(voterId)];
  if (prev !== 'pending') {
    return;
  }

  pending.responses[String(voterId)] = accept ? 'yes' : 'no';

  debug(1, '[deck] import wipe confirm vote (RQ)', {
    gameId,
    confirmId,
    voterId,
    accept,
    responses: pending.responses,
  });

  broadcastConfirmUpdate(io, confirmId, pending);

  const anyNo = Object.values(pending.responses).some((v) => v === 'no');
  if (anyNo) {
    cancelConfirmation(io, confirmId, 'voted_no');
    return;
  }

  const allYes = Object.values(pending.responses).every((v) => v === 'yes');
  if (allYes) {
    debug(1, '[deck] all players accepted import (RQ)', {
      gameId,
      confirmId,
    });
    applyConfirmedImport(io, confirmId).catch((err) => {
      debugError(1, 'applyConfirmedImport failed:', err);
      cancelConfirmation(io, confirmId, 'apply_failed');
    });
  }
}



/* --- Main registration: socket handlers for deck management --- */
export function registerDeckHandlers(io: Server, socket: Socket) {
  // New: Preflight check for importer-only import (no room wipe)
  socket.on(
    "canImportWithoutWipe",
    (payload?: { gameId?: unknown }, cb?: (resp: any) => void) => {
      try {
        const gameId = payload?.gameId;
        if (!gameId || typeof gameId !== "string") {
          if (typeof cb === "function") cb({ error: "missing_gameId" });
          return;
        }

        if (!isSocketInGameRoom(socket, gameId)) {
          if (typeof cb === "function") cb({ error: "not_in_game" });
          return;
        }

        const game = ensureGame(gameId);
        if (!game) {
          if (typeof cb === "function") cb({ error: "game_not_found" });
          return;
        }
        const rawPhase = (game.state && (game.state as any).phase) ?? "";
        const phaseStr = String(rawPhase).toUpperCase().trim();
        const seqVal =
          typeof (game as any).seq === "number" ? (game as any).seq : null;
        const isPreGame =
          phaseStr === "" ||
          phaseStr.includes("PRE") ||
          phaseStr.includes("BEGIN") ||
          seqVal === 0 ||
          seqVal === null;

        debug(1, "[deck] canImportWithoutWipe", {
          gameId,
          phaseStr,
          seqVal,
          isPreGame,
        });

        if (typeof cb === "function")
          cb({ importerOnly: isPreGame, phase: phaseStr, seq: seqVal });
      } catch (err) {
        debugWarn(1, "canImportWithoutWipe handler failed:", err);
        if (typeof cb === "function") cb({ error: String(err) });
      }
    }
  );

  registerImportDeckHandler(io, socket);


  // getImportedDeckCandidates
  socket.on("getImportedDeckCandidates", (payload?: { gameId?: unknown }) => {
    const gameId = payload?.gameId;
    const safeGameId = typeof gameId === "string" ? gameId : undefined;
    const pid = socket.data.playerId as PlayerID | undefined;
    const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
    if (!pid || socketIsSpectator) {
      socket.emit("importedDeckCandidates", { gameId: safeGameId, candidates: [] });
      return;
    }
    if (!gameId || typeof gameId !== "string") {
      socket.emit("importedDeckCandidates", { gameId: safeGameId, candidates: [] });
      return;
    }

    if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
      socket.emit("importedDeckCandidates", { gameId: safeGameId, candidates: [] });
      return;
    }

    try {
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("importedDeckCandidates", { gameId: safeGameId, candidates: [] });
        return;
      }

      const players = (game.state as any)?.players;
      const me = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
      if (!me || me.spectator || me.isSpectator) {
        socket.emit("importedDeckCandidates", { gameId: safeGameId, candidates: [] });
        return;
      }

      const buf = (game as any)._lastImportedDecks as
        | Map<PlayerID, any[]>
        | undefined;
      const local = buf ? buf.get(pid) || [] : [];
      const candidates = (local || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        image_uris: c.image_uris,
      }));
      debug(1, "[deck] getImportedDeckCandidates", {
        gameId,
        playerId: pid,
        candidatesCount: candidates.length,
      });
      socket.emit("importedDeckCandidates", { gameId: safeGameId, candidates });
    } catch (err) {
      debugWarn(1, "getImportedDeckCandidates failed:", err);
      socket.emit("importedDeckCandidates", { gameId: safeGameId, candidates: [] });
    }
  });

  registerUseSavedDeckHandler(io, socket);


  // saveDeck - save a new deck to the database
  socket.on(
    "saveDeck",
    (payload?: {
      gameId?: string;
      name?: string;
      list?: string;
      cacheCards?: boolean;
      folder?: string;
      visibility?: string;
    }) => {
      const gameId = payload?.gameId;
      const name = payload?.name;
      const list = payload?.list;
      const cacheCards = payload?.cacheCards;
      const folder = payload?.folder;
      (async () => {
        try {
          debug(1, "[deck] saveDeck called", {
            gameId,
            name,
            cacheCards,
            folder,
            playerId: socket.data.playerId,
          });

          if (!gameId || typeof gameId !== "string") {
            socket.emit("deckError", { gameId, message: "GameId required." });
            return;
          }

          if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
            socket.emit("deckError", { gameId, message: "Not in game." });
            return;
          }

          const pid = socket.data.playerId as PlayerID | undefined;
          const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
          if (!pid || socketIsSpectator) {
            socket.emit("deckError", {
              gameId,
              message: "Spectators cannot save decks.",
            });
            return;
          }

          if (!name || typeof name !== "string" || !name.trim()) {
            socket.emit("deckError", { gameId, message: "Deck name required." });
            return;
          }

          if (!list || typeof list !== "string" || !list.trim()) {
            socket.emit("deckError", { gameId, message: "Deck list required." });
            return;
          }

          const game = ensureGame(gameId);
          if (!game) {
            socket.emit("deckError", { gameId, message: "Game not found." });
            return;
          }

          const players = (game.state as any)?.players;
          const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
          if (!seated || seated.spectator || seated.isSpectator) {
            socket.emit("deckError", { gameId, message: "Not authorized." });
            return;
          }

          // Parse the deck list to get card count
          let cardCount = 0;
          let parsed: Array<{ name: string; count: number }> = [];
          try {
            parsed = parseDecklist(list);
            cardCount = parsed.reduce((sum, p) => sum + (p.count || 0), 0);
          } catch (e) {
            debugWarn(1, "saveDeck: parseDecklist failed, using line count estimate", e);
            // Fallback: count non-empty, non-comment, non-section-header lines
            const lines = list.split(/\r?\n/).filter((l) => !shouldSkipDeckLine(l));
            cardCount = lines.length;
          }

          // Get player name from game state
          const playerName = seated?.name || String(pid);

          const deckId = `deck_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}`;

          // If caching is requested, resolve cards from Scryfall
          let resolvedCardsJson: string | null = null;
          if (cacheCards && parsed.length > 0) {
            try {
              const resolution = await resolveDeckList(parsed, {
                uniqueInstanceIds: false,
                onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "saveDeck cacheCards", {
                  playerId: pid,
                  slowFallbackNotice: "none",
                }),
              });
              if (resolution.resolvedCards.length > 0) {
                resolvedCardsJson = JSON.stringify(resolution.resolvedCards);
                debug(1, "[deck] saveDeck caching resolved cards", {
                  deckId,
                  resolvedCount: resolution.resolvedCards.length,
                  usedLocalFallback: resolution.usedLocalFallback,
                  sourcesUsed: resolution.sourcesUsed,
                  scryfallTimedOut: resolution.scryfallTimedOut,
                });
              }
            } catch (e) {
              debugWarn(1, "saveDeck: failed to resolve cards for caching", e);
              // Continue without caching - still save the deck
            }
          }

          // Re-validate the handshake token if the account identity is missing on this socket.
          if (!getSocketAccountUserId(socket)) attachSocketAuth(socket);
          const accountUserId = getSocketAccountUserId(socket);
          if (!accountUserId && (payload as any)?.visibility === "private") {
            // Never silently downgrade an explicit private save to a public deck.
            socket.emit("deckError", {
              gameId,
              message:
                "You are not logged in on this connection, so a private deck cannot be saved. Log in (or refresh the page) and try again.",
            });
            return;
          }
          saveDeckDB({
            id: deckId,
            name: name.trim(),
            text: list,
            created_by_id: accountUserId || pid,
            created_by_name: (socket.data as any)?.accountDisplayName || playerName,
            card_count: cardCount,
            resolved_cards: resolvedCardsJson,
            folder: folder || '',
            visibility: normalizeDeckVisibility((payload as any)?.visibility, accountUserId ? 'private' : 'public'),
          });

          debug(1, "[deck] saveDeck saved", {
            gameId,
            deckId,
            name: name.trim(),
            cardCount,
            cached: !!resolvedCardsJson,
            folder: folder || '',
          });

          socket.emit("deckSaved", { gameId, deckId, cached: !!resolvedCardsJson });

          // Broadcast updated deck list and folder tree to all clients in the game
          const allDecks = visibleDecksForSocket(socket);
          // Send to the saver only: the list is filtered to what THIS account may see, so a room-wide
          // broadcast would overwrite other players' lists (and expose the saver's private decks).
          socket.emit("savedDecksList", {
            gameId,
            decks: allDecks,
            folders: buildFolderTree(allDecks),
          });
        } catch (err) {
          debugError(1, "saveDeck handler failed:", err);
          socket.emit("deckError", {
            gameId,
            message: "Failed to save deck.",
          });
        }
      })();
    }
  );

  // updateSavedDeck - update an existing deck's name and list (owner-only)
  socket.on(
    "updateSavedDeck",
    (payload?: {
      gameId?: string;
      deckId?: string;
      name?: string;
      list?: string;
      cacheCards?: boolean;
    }) => {
      const gameId = payload?.gameId;
      const deckId = payload?.deckId;
      const name = payload?.name;
      const list = payload?.list;
      const cacheCards = payload?.cacheCards;
      (async () => {
        try {
          if (!gameId || typeof gameId !== "string") {
            socket.emit("deckError", { gameId, message: "GameId required." });
            return;
          }

          if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
            socket.emit("deckError", { gameId, message: "Not in game." });
            return;
          }

          const pid = socket.data.playerId as PlayerID | undefined;
          const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
          if (!pid || socketIsSpectator) {
            socket.emit("deckError", { gameId, message: "Spectators cannot edit decks." });
            return;
          }

          if (!deckId || typeof deckId !== "string") {
            socket.emit("deckError", { gameId, message: "DeckId required." });
            return;
          }

          if (!name || typeof name !== "string" || !name.trim()) {
            socket.emit("deckError", { gameId, message: "Deck name required." });
            return;
          }

          if (!list || typeof list !== "string" || !list.trim()) {
            socket.emit("deckError", { gameId, message: "Deck list required." });
            return;
          }

          const game = ensureGame(gameId);
          if (!game) {
            socket.emit("deckError", { gameId, message: "Game not found." });
            return;
          }

          const players = (game.state as any)?.players;
          const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
          if (!seated || seated.spectator || seated.isSpectator) {
            socket.emit("deckError", { gameId, message: "Not authorized." });
            return;
          }

          const existing = getDeckDB(deckId);
          if (!existing) {
            socket.emit("deckError", { gameId, message: "Deck not found." });
            return;
          }

          if (!canModifySavedDeck(socket, existing, pid)) {
            socket.emit("deckError", { gameId, message: "You can only edit decks you created." });
            return;
          }

          let cardCount = 0;
          let parsed: Array<{ name: string; count: number }> = [];
          try {
            parsed = parseDecklist(list);
            cardCount = parsed.reduce((sum, p) => sum + (p.count || 0), 0);
          } catch (e) {
            debugWarn(1, "updateSavedDeck: parseDecklist failed, using line count estimate", e);
            const lines = list.split(/\r?\n/).filter((l) => !shouldSkipDeckLine(l));
            cardCount = lines.length;
          }

          let resolvedCardsJson: string | null = null;
          if (cacheCards && parsed.length > 0) {
            try {
              const resolution = await resolveDeckList(parsed, {
                uniqueInstanceIds: false,
                onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "updateSavedDeck cacheCards", {
                  playerId: pid,
                  slowFallbackNotice: "none",
                }),
              });
              if (resolution.resolvedCards.length > 0) {
                resolvedCardsJson = JSON.stringify(resolution.resolvedCards);
              }
            } catch (e) {
              debugWarn(1, "updateSavedDeck: failed to resolve cards for caching", e);
            }
          }

          const updated = updateDeckContentDB(deckId, {
            name: name.trim(),
            text: list,
            card_count: cardCount,
            resolved_cards: resolvedCardsJson,
          });
          if (!updated) {
            socket.emit("deckError", { gameId, message: "Failed to update deck." });
            return;
          }

          socket.emit("deckUpdated", { gameId, deck: updated });

          const allDecks = visibleDecksForSocket(socket);
          socket.emit("savedDecksList", {
            gameId,
            decks: allDecks,
            folders: buildFolderTree(allDecks),
          });
        } catch (err) {
          debugError(1, "updateSavedDeck handler failed:", err);
          socket.emit("deckError", { gameId, message: "Failed to update deck." });
        }
      })();
    }
  );

  // listSavedDecks - get all saved decks
  socket.on(
    "listSavedDecks",
    (payload?: { gameId?: unknown; folder?: unknown }) => {
      const gameId = payload?.gameId;
      const folder = payload?.folder;
      const safeGameId = typeof gameId === "string" ? gameId : undefined;
    try {
      debug(1, "[deck] listSavedDecks called", {
        gameId: safeGameId,
        folder: typeof folder === 'string' ? folder : undefined,
        playerId: socket.data.playerId,
      });

      if (!gameId || typeof gameId !== "string") {
        socket.emit("deckError", { gameId: safeGameId, message: "GameId required." });
        return;
      }

      const pid = socket.data.playerId as PlayerID | undefined;
      const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
      if (!pid || socketIsSpectator) {
        socket.emit("deckError", { gameId: safeGameId, message: "Not authorized." });
        return;
      }

      if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
        socket.emit("deckError", { gameId: safeGameId, message: "Not in game." });
        return;
      }

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("deckError", { gameId: safeGameId, message: "Game not found." });
        return;
      }

      const players = (game.state as any)?.players;
      const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
      if (!seated || seated.spectator || seated.isSpectator) {
        socket.emit("deckError", { gameId: safeGameId, message: "Not authorized." });
        return;
      }

      const allDecks = visibleDecksForSocket(socket);
      const folderStr = typeof folder === 'string' ? folder : undefined;
      const decksToShow = folderStr !== undefined 
        ? allDecks.filter(d => d.folder === folderStr)
        : allDecks;
      socket.emit("savedDecksList", { 
        gameId: safeGameId, 
        decks: decksToShow,
        folders: buildFolderTree(allDecks),
        currentFolder: folderStr || ''
      });
    } catch (err) {
      debugError(1, "listSavedDecks handler failed:", err);
      socket.emit("deckError", {
        gameId: safeGameId,
        message: "Failed to list decks.",
      });
    }
    }
  );

  // getSavedDeck - get details of a specific saved deck
  socket.on(
    "getSavedDeck",
    (payload?: { gameId?: unknown; deckId?: unknown }) => {
      const safeGameId = typeof payload?.gameId === "string" ? payload.gameId : undefined;
      try {
        const gameId = payload?.gameId;
        const deckId = payload?.deckId;
        debug(1, "[deck] getSavedDeck called", {
          gameId,
          deckId,
          playerId: socket.data.playerId,
        });

        if (!gameId || typeof gameId !== "string") {
          socket.emit("deckError", { gameId, message: "GameId required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
          socket.emit("deckError", { gameId, message: "Not in game." });
          return;
        }

        const game = ensureGame(gameId);
        if (!game) {
          socket.emit("deckError", { gameId, message: "Game not found." });
          return;
        }

        const statePlayers = (game.state as any)?.players;
        const seated = Array.isArray(statePlayers)
          ? statePlayers.find((p: any) => p && p.id === pid)
          : undefined;
        if (!seated || seated.spectator || seated.isSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (!deckId || typeof deckId !== "string") {
          socket.emit("deckError", { gameId, message: "DeckId required." });
          return;
        }

        const deck = getDeckDB(deckId);
        if (!deck || !canReadDeck(deck, getSocketAccountUserId(socket), getSocketAccountIsAdmin(socket))) {
          socket.emit("deckError", { gameId, message: "Deck not found." });
          return;
        }

        socket.emit("savedDeckDetail", { gameId, deck });
      } catch (err) {
        debugError(1, "getSavedDeck handler failed:", err);
        socket.emit("deckError", {
          gameId: safeGameId,
          message: "Failed to get deck details.",
        });
      }
    }
  );

  // renameSavedDeck - rename an existing deck
  socket.on(
    "renameSavedDeck",
    (payload?: {
      gameId?: string;
      deckId?: string;
      name?: string;
    }) => {
      const gameId = payload?.gameId;
      const deckId = payload?.deckId;
      const name = payload?.name;
      try {
        debug(1, "[deck] renameSavedDeck called", {
          gameId,
          deckId,
          newName: name,
          playerId: socket.data.playerId,
        });

        if (!gameId || typeof gameId !== "string") {
          socket.emit("deckError", { gameId, message: "GameId required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
          socket.emit("deckError", { gameId, message: "Not in game." });
          return;
        }

        const game = ensureGame(gameId);
        if (!game) {
          socket.emit("deckError", { gameId, message: "Game not found." });
          return;
        }

        const statePlayers = (game.state as any)?.players;
        const seated = Array.isArray(statePlayers)
          ? statePlayers.find((p: any) => p && p.id === pid)
          : undefined;
        if (!seated || seated.spectator || seated.isSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (!deckId || typeof deckId !== "string") {
          socket.emit("deckError", { gameId, message: "DeckId required." });
          return;
        }

        if (!name || typeof name !== "string" || !name.trim()) {
          socket.emit("deckError", { gameId, message: "New name required." });
          return;
        }

        const existing = getDeckDB(deckId);
        if (!existing) {
          socket.emit("deckError", { gameId, message: "Deck not found." });
          return;
        }

        if (!canModifySavedDeck(socket, existing, pid)) {
          socket.emit("deckError", { gameId, message: "You can only rename decks you created." });
          return;
        }

        const deck = renameDeckDB(deckId, name.trim());
        if (!deck) {
          socket.emit("deckError", { gameId, message: "Deck not found." });
          return;
        }

        socket.emit("deckRenamed", { gameId, deck });

        // Broadcast updated deck list
        socket.emit("savedDecksList", {
          gameId,
          decks: visibleDecksForSocket(socket),
        });
      } catch (err) {
        debugError(1, "renameSavedDeck handler failed:", err);
        socket.emit("deckError", {
          gameId,
          message: "Failed to rename deck.",
        });
      }
    }
  );

  // deleteSavedDeck - delete a saved deck
  socket.on(
    "deleteSavedDeck",
    (payload?: { gameId?: string; deckId?: string }) => {
      const gameId = payload?.gameId;
      const deckId = payload?.deckId;
      try {
        debug(1, "[deck] deleteSavedDeck called", {
          gameId,
          deckId,
          playerId: socket.data.playerId,
        });

        if (!gameId || typeof gameId !== "string") {
          socket.emit("deckError", { gameId, message: "GameId required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
          socket.emit("deckError", { gameId, message: "Not in game." });
          return;
        }

        const game = ensureGame(gameId);
        if (!game) {
          socket.emit("deckError", { gameId, message: "Game not found." });
          return;
        }

        const statePlayers = (game.state as any)?.players;
        const seated = Array.isArray(statePlayers)
          ? statePlayers.find((p: any) => p && p.id === pid)
          : undefined;
        if (!seated || seated.spectator || seated.isSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (!deckId || typeof deckId !== "string") {
          socket.emit("deckError", { gameId, message: "DeckId required." });
          return;
        }

        const existing = getDeckDB(deckId);
        if (!existing) {
          socket.emit("deckError", { gameId, message: "Deck not found." });
          return;
        }

        if (!canModifySavedDeck(socket, existing, pid)) {
          socket.emit("deckError", { gameId, message: "You can only delete decks you created." });
          return;
        }

        const deleted = deleteDeckDB(deckId);
        if (!deleted) {
          socket.emit("deckError", { gameId, message: "Deck not found." });
          return;
        }

        socket.emit("deckDeleted", { gameId, deckId });

        // Broadcast updated deck list
        socket.emit("savedDecksList", {
          gameId,
          decks: visibleDecksForSocket(socket),
        });
      } catch (err) {
        debugError(1, "deleteSavedDeck handler failed:", err);
        socket.emit("deckError", {
          gameId,
          message: "Failed to delete deck.",
        });
      }
    }
  );

  // cacheSavedDeck - add cached card data to an existing saved deck
  socket.on(
    "cacheSavedDeck",
    async (payload?: { gameId?: string; deckId?: string }) => {
      const gameId = payload?.gameId;
      const deckId = payload?.deckId;
      try {
        debug(1, "[deck] cacheSavedDeck called", {
          gameId,
          deckId,
          playerId: socket.data.playerId,
        });

        if (!gameId || typeof gameId !== "string") {
          socket.emit("deckError", { gameId, message: "GameId required." });
          return;
        }

        if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
          socket.emit("deckError", { gameId, message: "Not in game." });
          return;
        }

        const game = ensureGame(gameId);
        if (!game) {
          socket.emit("deckError", { gameId, message: "Game not found." });
          return;
        }

        if (!deckId || typeof deckId !== "string") {
          socket.emit("deckError", { gameId, message: "DeckId required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", {
            gameId,
            message: "Spectators cannot cache decks.",
          });
          return;
        }

        const players = (game.state as any)?.players;
        const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
        if (!seated || seated.spectator || seated.isSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        const saved = getDeckDB(deckId);
        if (!saved) {
          socket.emit("deckError", { gameId, message: "Deck not found." });
          return;
        }

        if (!canModifySavedDeck(socket, saved, pid)) {
          socket.emit("deckError", { gameId, message: "You can only cache decks you created." });
          return;
        }

        // Check if already cached
        if (saved.has_cached_cards) {
          socket.emit("deckCached", { gameId, deckId, alreadyCached: true });
          return;
        }

        // Parse and resolve cards
        const list = saved.text || "";
        let parsed: Array<{ name: string; count: number }>;
        try {
          parsed = parseDecklist(list);
          if (!Array.isArray(parsed) || parsed.length === 0) {
            socket.emit("deckError", {
              gameId,
              message: "Deck appears empty or invalid.",
            });
            return;
          }
        } catch {
          socket.emit("deckError", {
            gameId,
            message: "Failed to parse deck list.",
          });
          return;
        }

        const resolution = await resolveDeckList(parsed, {
          uniqueInstanceIds: false,
          onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "cacheSavedDeck", {
            playerId: pid,
            slowFallbackNotice: "socket",
          }),
        });
        const resolvedCards = resolution.resolvedCards;

        if (resolvedCards.length === 0) {
          socket.emit("deckError", {
            gameId,
            message: "No cards could be resolved.",
          });
          return;
        }

        // Update the deck with cached cards
        const resolvedCardsJson = JSON.stringify(resolvedCards);
        const updated = updateDeckResolvedCards(deckId, resolvedCardsJson);

        if (!updated) {
          socket.emit("deckError", {
            gameId,
            message: "Failed to update deck cache.",
          });
          return;
        }

        debug(1, "[deck] cacheSavedDeck completed", {
          gameId,
          deckId,
          cachedCount: resolvedCards.length,
          usedLocalFallback: resolution.usedLocalFallback,
          sourcesUsed: resolution.sourcesUsed,
          scryfallTimedOut: resolution.scryfallTimedOut,
        });

        socket.emit("deckCached", { gameId, deckId, cachedCount: resolvedCards.length });

        // Broadcast updated deck list to show the cached indicator
        const allDecks = visibleDecksForSocket(socket);
        socket.emit("savedDecksList", {
          gameId,
          decks: allDecks,
          folders: buildFolderTree(allDecks),
        });
      } catch (err) {
        debugError(1, "cacheSavedDeck handler failed:", err);
        socket.emit("deckError", {
          gameId,
          message: "Failed to cache deck.",
        });
      }
    }
  );

  // moveDeckToFolder - move a deck to a different folder
  socket.on(
    "moveDeckToFolder",
    (payload?: { gameId?: string; deckId?: string; folder?: string }) => {
      const gameId = payload?.gameId;
      const deckId = payload?.deckId;
      const folder = payload?.folder;
      try {
        debug(1, "[deck] moveDeckToFolder called", {
          gameId,
          deckId,
          folder,
          playerId: socket.data.playerId,
        });

        if (!gameId || typeof gameId !== "string") {
          socket.emit("deckError", { gameId, message: "GameId required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
          socket.emit("deckError", { gameId, message: "Not in game." });
          return;
        }

        const game = ensureGame(gameId);
        if (!game) {
          socket.emit("deckError", { gameId, message: "Game not found." });
          return;
        }

        const players = (game.state as any)?.players;
        const seated = Array.isArray(players) ? players.find((p: any) => p && p.id === pid) : undefined;
        if (!seated || seated.spectator || seated.isSpectator) {
          socket.emit("deckError", { gameId, message: "Not authorized." });
          return;
        }

        if (!deckId || typeof deckId !== "string") {
          socket.emit("deckError", { gameId, message: "DeckId required." });
          return;
        }

        const moved = moveDeckToFolder(deckId, folder || '');
        if (!moved) {
          socket.emit("deckError", { gameId, message: "Deck not found." });
          return;
        }

        debug(1, "[deck] moveDeckToFolder completed", {
          gameId,
          deckId,
          folder,
        });

        socket.emit("deckMoved", { gameId, deckId, folder });

        // Broadcast updated deck list
        const allDecks = visibleDecksForSocket(socket);
        socket.emit("savedDecksList", {
          gameId,
          decks: allDecks,
          folders: buildFolderTree(allDecks),
        });
      } catch (err) {
        debugError(1, "moveDeckToFolder handler failed:", err);
        socket.emit("deckError", {
          gameId,
          message: "Failed to move deck.",
        });
      }
    }
  );

  registerImportPreconDeckHandler(io, socket);

  registerImportDeckFromUrlHandler(io, socket);

}


