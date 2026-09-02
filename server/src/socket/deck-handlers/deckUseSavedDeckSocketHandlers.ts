/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: the useSavedDeck socket handler inside registerDeckHandlers.
 *
 * Public entry symbols: registerUseSavedDeckHandler.
 */
import type { Server, Socket } from "socket.io";
import { createCardFromScryfall } from "../../../../shared/src";
import type { KnownCardRef, PlayerID } from "../../../../shared/src";
import { getDeck as getDeckDB } from "../../db/decks";
import { canReadDeck } from "../../decks/deckAccess.js";
import { getSocketAccountUserId } from "../../auth/attachSocketAuth.js";
import { resolveDeckList } from "../../services/deckImport.js";
import { parseDecklist } from "../../services/scryfall";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util";
import { applyConfirmedImport } from "./deckApplyConfirmedImport.js";
import {
  addPendingInitialDrawFlag,
  broadcastConfirmUpdate,
  cancelConfirmation,
  clearPlayerTransientZonesForImport,
  getActivePlayerIds,
  suggestCommanderNames,
} from "./deckImportConfirmHelpers.js";
import {
  isSocketInGameRoom,
  makeImportConfirmId,
  pendingImportConfirmations,
  toImportBufferCard,
  type PendingConfirm,
} from "./deckImportConfirmState.js";
import {
  createDeckResolutionStatusReporter,
  enqueueImportWipeConfirmToResolutionQueue,
  generateUniqueCardInstanceId,
} from "./deckImportResolutionSupport.js";

export function registerUseSavedDeckHandler(io: Server, socket: Socket) {
  // NEW: useSavedDeck - apply a previously saved deck using the same flow as importDeck
  socket.on(
    "useSavedDeck",
    async (payload?: { gameId?: unknown; deckId?: unknown }) => {
      const safeGameId = typeof payload?.gameId === "string" ? payload.gameId : undefined;
      try {
        const gameId = payload?.gameId;
        const deckId = payload?.deckId;
        debug(1, "[deck] useSavedDeck called", {
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
        if (!deckId || typeof deckId !== "string") {
          socket.emit("deckError", { gameId, message: "DeckId required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", {
            gameId,
            message: "Spectators cannot use saved decks.",
          });
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

        const saved = getDeckDB(deckId);
        if (!saved || !canReadDeck(saved, getSocketAccountUserId(socket))) {
          socket.emit("deckError", {
            gameId,
            message: "Saved deck not found.",
          });
          return;
        }

        const list = saved.text || "";
        const deckName = saved.name || deckId;

        // Check if we have cached resolved cards
        const hasCachedCards = saved.cached_cards && Array.isArray(saved.cached_cards) && saved.cached_cards.length > 0;
        
        let resolvedCards: Array<
          Pick<
            KnownCardRef,
            "id" | "name" | "type_line" | "oracle_text" | "image_uris" | "mana_cost" | "power" | "toughness" | "card_faces" | "layout" | "loyalty"
          >
        > = [];
        let missing: string[] = [];
        let usedCache = false;
        let parsed: Array<{ name: string; count: number }> = [];

        if (hasCachedCards) {
          // Use cached cards - no need to query Scryfall API
          // IMPORTANT: Generate unique instance IDs even for cached cards to avoid
          // duplicate ID issues with multiple copies of the same card (e.g., basic lands)
          resolvedCards = saved.cached_cards!.map((c: any) => 
            createCardFromScryfall(c, { instanceId: generateUniqueCardInstanceId(c.id) })
          );
          usedCache = true;
          debug(1, "[deck] useSavedDeck using cached cards", {
            gameId,
            deckId,
            cachedCount: resolvedCards.length,
          });
        } else {
          // No cache - need to resolve from Scryfall
          // Parse decklist from saved text
          try {
            parsed = parseDecklist(list);
            if (!Array.isArray(parsed) || parsed.length === 0) {
              socket.emit("deckError", {
                gameId,
                message: "Saved deck appears empty or invalid.",
              });
              return;
            }
          } catch {
            socket.emit("deckError", {
              gameId,
              message: "Failed to parse saved deck list.",
            });
            return;
          }

          const resolution = await resolveDeckList(parsed, {
            uniqueInstanceIds: true,
            onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "useSavedDeck", {
              playerId: pid,
              slowFallbackNotice: "socket",
            }),
          });
          resolvedCards = resolution.resolvedCards;
          missing = resolution.missing;

          debug(1, "[deck] useSavedDeck uncached resolution metadata", {
            gameId,
            deckId,
            playerId: pid,
            usedLocalFallback: resolution.usedLocalFallback,
            sourcesUsed: resolution.sourcesUsed,
            scryfallTimedOut: resolution.scryfallTimedOut,
          });
        }

        const sampleFirst = resolvedCards[0];
        const sampleLast =
          resolvedCards.length > 1
            ? resolvedCards[resolvedCards.length - 1]
            : null;
        debug(1, "[deck] useSavedDeck resolved cards", {
          gameId,
          deckId,
          playerId: pid,
          usedCache,
          resolvedCount: resolvedCards.length,
          missingCount: missing.length,
          firstCard: sampleFirst
            ? {
                name: sampleFirst.name,
                id: sampleFirst.id,
                type_line: sampleFirst.type_line,
              }
            : null,
          lastCard: sampleLast
            ? {
                name: sampleLast.name,
                id: sampleLast.id,
                type_line: sampleLast.type_line,
              }
            : null,
        });

        if (missing.length) {
          try {
            socket.emit("deckImportMissing", { gameId, missing });
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `Missing (from saved deck): ${missing
                .slice(0, 10)
                .join(", ")}${missing.length > 10 ? ", …" : ""}`,
              ts: Date.now(),
            });
          } catch (e) {
            debugWarn(1, "useSavedDeck: emit deckImportMissing failed", e);
          }
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

        debug(1, "[deck] useSavedDeck pregame-check", {
          gameId,
          deckId,
          playerId: pid,
          phaseStr,
          seqVal,
          isPreGame,
        });

        // Save _lastImportedDecks buffer as well, so getImportedDeckCandidates works
        try {
          (game as any)._lastImportedDecks =
            (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
          (game as any)._lastImportedDecks.set(
            pid,
            resolvedCards.map(toImportBufferCard)
          );
        } catch (e) {
          debugWarn(1, 
            "useSavedDeck: could not set _lastImportedDecks on game object",
            e
          );
        }

        const parsedCount = parsed.reduce((s, p) => s + (p.count || 0), 0);

        if (isPreGame) {
          const confirmId = makeImportConfirmId(gameId);
          const pending: PendingConfirm = {
            gameId,
            initiator: pid,
            resolvedCards,
            parsedCount,
            deckName,
            save: false,
            responses: { [pid]: "yes" },
            timeout: null,
            snapshotZones:
              game.state &&
              (game.state as any).zones &&
              (game.state as any).zones[pid]
                ? JSON.parse(
                    JSON.stringify((game.state as any).zones[pid])
                  )
                : null,
            snapshotCommandZone:
              game.state &&
              (game.state as any).commandZone &&
              (game.state as any).commandZone[pid]
                ? JSON.parse(
                    JSON.stringify(
                      (game.state as any).commandZone[pid]
                    )
                  )
                : null,
            snapshotPhase:
              game.state && (game.state as any).phase !== undefined
                ? (game.state as any).phase
                : null,
            applyImporterOnly: true,
          };
          pendingImportConfirmations.set(confirmId, pending);

          try {
            clearPlayerTransientZonesForImport(game, pid);
            addPendingInitialDrawFlag(game, pid);
            try {
              broadcastGame(io, game, gameId);
            } catch {
              /* best-effort */
            }
          } catch (e) {
            debugWarn(1, 
              "useSavedDeck (pre-game): clearing transient zones/flags failed",
              e
            );
          }

          try {
            const names = suggestCommanderNames(resolvedCards);
            socket.emit("suggestCommanders", { gameId, names });
          } catch (e) {
            debugWarn(1, "useSavedDeck: suggestCommanders emit failed", e);
          }

          setTimeout(() => {
            applyConfirmedImport(io, confirmId, socket).catch((err) => {
              debugError(1, "useSavedDeck immediate applyConfirmedImport failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 200);

          return;
        }

        // mid-game path: require unanimous approval (same as importDeck)
        const activePlayerIds = getActivePlayerIds(game, io, gameId);
        const players =
          activePlayerIds.length > 0
            ? activePlayerIds
            : (game.state.players || [])
                .map((p: any) => p.id)
                .filter(Boolean) as string[];

        const confirmId = makeImportConfirmId(gameId);
        const responses: Record<string, "pending" | "yes" | "no"> = {};
        for (const pl of players) responses[pl] = "pending";
        responses[pid] = "yes";

        const snapshotZones =
          game.state &&
          (game.state as any).zones &&
          (game.state as any).zones[pid]
            ? JSON.parse(JSON.stringify((game.state as any).zones[pid]))
            : null;
        const snapshotCommandZone =
          game.state &&
          (game.state as any).commandZone &&
          (game.state as any).commandZone[pid]
            ? JSON.parse(
                JSON.stringify((game.state as any).commandZone[pid])
              )
            : null;
        const snapshotPhase =
          game.state && (game.state as any).phase !== undefined
            ? (game.state as any).phase
            : null;

        const pendingConfirm: PendingConfirm = {
          gameId,
          initiator: pid,
          resolvedCards,
          parsedCount,
          deckName,
          save: false,
          responses,
          timeout: null,
          snapshotZones,
          snapshotCommandZone,
          snapshotPhase,
          applyImporterOnly: false,
        };

        const TIMEOUT_MS = 60_000;
        pendingConfirm.timeout = setTimeout(() => {
          cancelConfirmation(io, confirmId, "timeout");
        }, TIMEOUT_MS);

        pendingImportConfirmations.set(confirmId, pendingConfirm);

        try {
          clearPlayerTransientZonesForImport(game, pid);
          addPendingInitialDrawFlag(game, pid);
          try {
            broadcastGame(io, game, gameId);
          } catch {
            /* best-effort */
          }
        } catch (e) {
          debugWarn(1, "useSavedDeck: clearing transient zones/flags failed", e);
        }

        try {
          enqueueImportWipeConfirmToResolutionQueue(
            gameId,
            confirmId,
            pendingConfirm,
            players as any,
            TIMEOUT_MS
          );
        } catch (err) {
          debugWarn(1, "useSavedDeck: enqueue import wipe confirm failed", err);
        }

        broadcastConfirmUpdate(io, confirmId, pendingConfirm);

        try {
          if (players.length <= 1) {
            debug(1, "[deck] useSavedDeck auto-applyConfirmedImport for single player", {
              gameId,
              confirmId,
            });
            setTimeout(() => {
              applyConfirmedImport(io, confirmId).catch((err) => {
                debugError(1, "useSavedDeck auto applyConfirmedImport failed:", err);
                cancelConfirmation(io, confirmId, "apply_failed");
              });
            }, 250);
          }
        } catch (e) {
          debugWarn(1, "useSavedDeck: auto-apply single-player failed", e);
        }
      } catch (err) {
        debugError(1, "useSavedDeck handler failed:", err);
        try {
          socket.emit("deckError", {
            gameId: safeGameId,
            message: "Failed to apply saved deck.",
          });
        } catch {
          /* ignore */
        }
      }
    }
  );
}
