/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: the importDeckFromUrl socket handler inside registerDeckHandlers.
 *
 * Public entry symbols: registerImportDeckFromUrlHandler.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src";
import { resolveDeckList } from "../../services/deckImport.js";
import {
  fetchDeckFromMoxfield,
  isMoxfieldUrl,
  validateDeck,
} from "../../services/scryfall";
import { debug, debugError, debugWarn } from "../../utils/debug.js";
import { broadcastGame, ensureGame } from "../util";
import { applyConfirmedImport } from "./deckApplyConfirmedImport.js";
import {
  addPendingInitialDrawFlag,
  broadcastConfirmUpdate,
  cancelConfirmation,
  clearPlayerTransientZonesForImport,
  getActivePlayerIds,
} from "./deckImportConfirmHelpers.js";
import {
  getSaveOwnerFromSocket,
  isSocketInGameRoom,
  makeImportConfirmId,
  pendingImportConfirmations,
  toImportBufferCard,
  type PendingConfirm,
} from "./deckImportConfirmState.js";
import {
  createDeckResolutionStatusReporter,
  enqueueImportWipeConfirmToResolutionQueue,
} from "./deckImportResolutionSupport.js";

export function registerImportDeckFromUrlHandler(io: Server, socket: Socket) {

  // importDeckFromUrl - import a deck from a Moxfield URL
  socket.on(
    "importDeckFromUrl",
    async (payload?: {
      gameId?: string;
      url?: string;
      save?: boolean;
    }) => {
      const gameId = payload?.gameId;
      const url = payload?.url;
      const save = payload?.save;
      try {
        debug(1, "[deck] importDeckFromUrl called", {
          gameId,
          url,
          playerId: socket.data.playerId,
        });

        if (!gameId || typeof gameId !== "string") {
          socket.emit("deckError", { gameId, message: "GameId required." });
          return;
        }

        if (!url || typeof url !== "string") {
          socket.emit("deckError", { gameId, message: "URL required." });
          return;
        }

        const pid = socket.data.playerId as PlayerID | undefined;
        if (((socket.data as any)?.gameId && (socket.data as any)?.gameId !== gameId) || !isSocketInGameRoom(socket, gameId)) {
          socket.emit("deckError", { gameId, message: "Not in game." });
          return;
        }

        const socketIsSpectator = !!((socket.data as any)?.spectator || (socket.data as any)?.isSpectator);
        if (!pid || socketIsSpectator) {
          socket.emit("deckError", {
            gameId,
            message: "Spectators cannot import decks.",
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

        // Validate URL format
        if (!isMoxfieldUrl(url)) {
          socket.emit("deckError", {
            gameId,
            message: "Currently only Moxfield URLs are supported (e.g., https://moxfield.com/decks/...).",
          });
          return;
        }

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `🔍 Fetching deck from Moxfield...`,
          ts: Date.now(),
        });

        // Fetch deck from Moxfield
        let moxfieldDeck: Awaited<ReturnType<typeof fetchDeckFromMoxfield>>;
        try {
          moxfieldDeck = await fetchDeckFromMoxfield(url);
        } catch (err) {
          debugError(1, "Failed to fetch deck from Moxfield:", err);
          socket.emit("deckError", {
            gameId,
            message: `Failed to fetch deck from Moxfield: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }

        const { name: deckName, commanders, cards: parsed } = moxfieldDeck;

        debug(1, "[deck] importDeckFromUrl fetched from Moxfield", {
          gameId,
          deckName,
          commanders,
          cardCount: parsed.length,
        });

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `📦 Found deck "${deckName}" with ${parsed.length} cards (Commanders: ${commanders.join(', ')})`,
          ts: Date.now(),
        });

        const {
          resolvedCards,
          validationCards,
          missing,
          usedLocalFallback,
          sourcesUsed,
          scryfallTimedOut,
        } = await resolveDeckList(parsed, {
          uniqueInstanceIds: true,
          onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "importDeckFromUrl", {
            playerId: pid,
            slowFallbackNotice: "room",
          }),
        });

        debug(1, "[deck] importDeckFromUrl resolved cards", {
          gameId,
          playerId: pid,
          resolvedCount: resolvedCards.length,
          missingCount: missing.length,
          usedLocalFallback,
          sourcesUsed,
          scryfallTimedOut,
        });

        try {
          (game as any)._lastImportedDecks =
            (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
          (game as any)._lastImportedDecks.set(
            pid,
            resolvedCards.map(toImportBufferCard)
          );
        } catch (e) {
          debugWarn(1, 
            "Could not set _lastImportedDecks on game object for importDeckFromUrl:",
            e
          );
        }

        // Run deck validation against game format
        try {
          const format = (game.state && (game.state as any).format) || "commander";
          const validation = validateDeck(format, validationCards);
          
          if (validation.illegal.length > 0 || validation.warnings.length > 0) {
            socket.emit("deckValidationResult", {
              gameId,
              format,
              cardCount: resolvedCards.length,
              illegal: validation.illegal,
              warnings: validation.warnings,
              valid: validation.illegal.length === 0,
            });
            
            if (validation.illegal.length > 0) {
              const illegalNames = validation.illegal.slice(0, 5).map(i => `${i.name} (${i.reason})`);
              io.to(gameId).emit("chat", {
                id: `m_${Date.now()}`,
                gameId,
                from: "system",
                message: `⚠️ Deck validation: ${validation.illegal.length} card(s) may not be legal in ${format}: ${illegalNames.join(", ")}${validation.illegal.length > 5 ? ", ..." : ""}`,
                ts: Date.now(),
              });
            }
          } else {
            socket.emit("deckValidationResult", {
              gameId,
              format,
              cardCount: resolvedCards.length,
              illegal: [],
              warnings: [],
              valid: true,
            });
          }
        } catch (e) {
          debugWarn(1, "[deck] Deck validation failed:", e);
        }

        if (missing.length) {
          try {
            socket.emit("deckImportMissing", { gameId, missing });
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `Missing cards: ${missing
                .slice(0, 10)
                .join(", ")}${missing.length > 10 ? ", …" : ""}`,
              ts: Date.now(),
            });
          } catch (e) {
            debugWarn(1, "emit deckImportMissing failed", e);
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

        debug(1, "[deck] importDeckFromUrl pregame-check", {
          gameId,
          playerId: pid,
          phaseStr,
          seqVal,
          isPreGame,
        });

        if (isPreGame) {
          const confirmId = makeImportConfirmId(gameId);
          const pending: PendingConfirm = {
            gameId,
            initiator: pid,
            resolvedCards,
            parsedCount: parsed.reduce((s, p) => s + (p.count || 0), 0),
            deckName,
            save,
            saveOwner: getSaveOwnerFromSocket(socket),
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
              "importDeckFromUrl (pre-game): clearing transient zones/flags failed",
              e
            );
          }

          try {
            debug(1, "[deck] importDeckFromUrl (pre-game) emitting suggestCommanders", {
              gameId,
              playerId: pid,
              names: commanders,
            });
            try {
              socket.emit("suggestCommanders", { gameId, names: commanders });
            } catch {
              /* ignore */
            }
          } catch {
            /* ignore */
          }

          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `✅ Imported ${resolvedCards.length} cards from Moxfield for "${deckName}"`,
            ts: Date.now(),
          });

          setTimeout(() => {
            applyConfirmedImport(io, confirmId, socket).catch((err) => {
              debugError(1, "immediate applyConfirmedImport failed:", err);
              cancelConfirmation(io, confirmId, "apply_failed");
            });
          }, 200);
          return;
        }

        // Mid-game path: require unanimous approval (same as importDeck)
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
          parsedCount: parsed.reduce((s, p) => s + (p.count || 0), 0),
          deckName,
          save,
          saveOwner: getSaveOwnerFromSocket(socket),
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
          try {
            broadcastGame(io, game, gameId);
          } catch {
            /* best-effort */
          }
        } catch (e) {
          debugWarn(1, "importDeckFromUrl: clearing transient zones failed", e);
        }

        try {
          addPendingInitialDrawFlag(game, pid);
          try {
            broadcastGame(io, game, gameId);
          } catch {
            /* best-effort */
          }
        } catch (e) {
          debugWarn(1, "importDeckFromUrl: addPendingInitialDrawFlag failed", e);
        }

        try {
          debug(1, "[deck] enqueueing import wipe confirmation (Resolution Queue)", {
            gameId,
            confirmId,
            initiator: pid,
            players: players.length,
            resolvedCount: resolvedCards.length,
          });
          enqueueImportWipeConfirmToResolutionQueue(
            gameId,
            confirmId,
            pendingConfirm,
            players as any,
            TIMEOUT_MS
          );
        } catch (err) {
          debugWarn(1, "importDeckFromUrl: enqueue import wipe confirm failed", err);
        }

        broadcastConfirmUpdate(io, confirmId, pendingConfirm);

        try {
          if (players.length <= 1) {
            debug(1, "[deck] auto-applyConfirmedImport for single player", {
              gameId,
              confirmId,
            });
            setTimeout(() => {
              applyConfirmedImport(io, confirmId).catch((err) => {
                debugError(1, "auto applyConfirmedImport failed:", err);
                cancelConfirmation(io, confirmId, "apply_failed");
              });
            }, 250);
          }
        } catch (e) {
          debugWarn(1, "importDeckFromUrl: auto-apply single-player failed", e);
        }
      } catch (err) {
        debugError(1, "importDeckFromUrl handler failed:", err);
        socket.emit("deckError", {
          gameId,
          message: "Failed to import deck from URL.",
        });
      }
    }
  );
}
