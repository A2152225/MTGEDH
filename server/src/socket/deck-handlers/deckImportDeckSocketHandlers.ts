/**
 * Origin parent: server/src/socket/deck.ts
 *
 * Cluster moved: the importDeck socket handler inside registerDeckHandlers.
 *
 * Public entry symbols: registerImportDeckHandler.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src";
import { resolveDeckList } from "../../services/deckImport.js";
import {
  fetchDeckFromMoxfield,
  isMoxfieldUrl,
  parseDecklist,
  parsedDecklistToExpandedString,
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
} from "./deckImportResolutionSupport.js";

export function registerImportDeckHandler(io: Server, socket: Socket) {
  // importDeck
  socket.on(
    "importDeck",
    async (payload?: {
      gameId?: unknown;
      list?: unknown;
      deckName?: unknown;
      save?: unknown;
    }) => {
      const gameId = payload?.gameId;
      const list = payload?.list;
      const deckName = payload?.deckName;
      const save = payload?.save;
      debug(1, "[deck] importDeck called", {
        gameId,
        playerId: socket.data.playerId,
      });

      // Validate incoming payload before calling ensureGame
      if (!gameId || typeof gameId !== "string") {
        socket.emit("deckError", { gameId, message: "GameId required." });
        return;
      }

      if (!isSocketInGameRoom(socket, gameId)) {
        socket.emit("deckError", { gameId, message: "Not in game." });
        return;
      }

      if (typeof list !== "string" || list.trim().length === 0) {
        socket.emit("deckError", { gameId, message: "Deck list required." });
        return;
      }

      const requestedDeckName = typeof deckName === "string" ? deckName : undefined;
      const saveFlag = save === true;
      let effectiveList: string = list;
      let effectiveDeckName: string | undefined = requestedDeckName;

      // Check if the list is actually a Moxfield URL - fetch the deck first
      if (isMoxfieldUrl(list.trim())) {
        debug(1, "[deck] importDeck detected Moxfield URL, will fetch deck from Moxfield", {
          gameId,
          url: list.trim(),
        });
        
        const pid = socket.data.playerId as PlayerID | undefined;
        const spectator = !!(
          (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
        );
        if (!pid || spectator) {
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

        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `🔍 Detected Moxfield URL, fetching deck...`,
          ts: Date.now(),
        });

        try {
          const moxfieldDeck = await fetchDeckFromMoxfield(list.trim());
          // Convert Moxfield deck to decklist text format, expanding cards with count > 1 into separate lines
          effectiveList = parsedDecklistToExpandedString(moxfieldDeck.cards);
          effectiveDeckName = requestedDeckName || moxfieldDeck.name;
          
          // Calculate total card count (not just unique cards)
          const totalCardCount = moxfieldDeck.cards.reduce((sum, c) => sum + c.count, 0);
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `📦 Found deck "${moxfieldDeck.name}" with ${totalCardCount} cards (${moxfieldDeck.cards.length} unique) (Commanders: ${moxfieldDeck.commanders.join(', ')})`,
            ts: Date.now(),
          });
        } catch (err) {
          debugError(1, "Failed to fetch deck from Moxfield:", err);
          socket.emit("deckError", {
            gameId,
            message: `Failed to fetch deck from Moxfield: ${err instanceof Error ? err.message : String(err)}`,
          });
          return;
        }
      }

      const pid = socket.data.playerId as PlayerID | undefined;
      const spectator = !!(
        (socket.data as any)?.spectator || (socket.data as any)?.isSpectator
      );
      if (!pid || spectator) {
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

      // Require the importer to actually be seated in the game.
      try {
        const seated = Array.isArray((game.state as any)?.players)
          ? (game.state as any).players.some(
              (p: any) =>
                p?.id === pid && !p?.spectator && !p?.isSpectator
            )
          : false;
        if (!seated) {
          socket.emit("deckError", {
            gameId,
            message: "You are not a player in this game.",
          });
          return;
        }
      } catch {
        socket.emit("deckError", {
          gameId,
          message: "You are not a player in this game.",
        });
        return;
      }

      // Parse decklist (using effectiveList which may have been converted from Moxfield)
      let parsed: Array<{ name: string; count: number }>;
      try {
        parsed = parseDecklist(effectiveList);
        if (!Array.isArray(parsed) || parsed.length === 0) {
          socket.emit("deckError", {
            gameId,
            message: "Deck list appears empty or invalid.",
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

      const {
        resolvedCards,
        validationCards,
        missing,
        usedLocalFallback,
        sourcesUsed,
        scryfallTimedOut,
      } = await resolveDeckList(parsed, {
        uniqueInstanceIds: true,
        onStatus: createDeckResolutionStatusReporter(io, socket, gameId, "importDeck", {
          playerId: pid,
          slowFallbackNotice: "room",
        }),
      });

      // Compact log: only show counts + first/last card, not whole deck
      const sampleFirst = resolvedCards[0];
      const sampleLast =
        resolvedCards.length > 1
          ? resolvedCards[resolvedCards.length - 1]
          : null;
      debug(1, "[deck] importDeck resolved cards", {
        gameId,
        playerId: pid,
        resolvedCount: resolvedCards.length,
        missingCount: missing.length,
        usedLocalFallback,
        sourcesUsed,
        scryfallTimedOut,
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

      try {
        (game as any)._lastImportedDecks =
          (game as any)._lastImportedDecks || new Map<PlayerID, any[]>();
        (game as any)._lastImportedDecks.set(
          pid,
          resolvedCards.map(toImportBufferCard)
        );
      } catch (e) {
        debugWarn(1, 
          "Could not set _lastImportedDecks on game object for importDeck:",
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
          
          // Also log to chat if there are illegal cards
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
          
          debug(1, "[deck] Validation result", {
            gameId,
            format,
            illegalCount: validation.illegal.length,
            warningCount: validation.warnings.length,
          });
        } else {
          // Send positive validation result
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
            message: `Missing (strict fetch): ${missing
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

      debug(1, "[deck] importDeck pregame-check", {
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
          deckName: effectiveDeckName,
          save: saveFlag,
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
            "importDeck (pre-game): clearing transient zones/flags failed",
            e
          );
        }

        try {
          const names = suggestCommanderNames(resolvedCards);
          debug(1, "[deck] importDeck (pre-game) emitting suggestCommanders", {
            gameId,
            playerId: pid,
            names,
          });
          try {
            socket.emit("suggestCommanders", { gameId, names });
          } catch {
            /* ignore */
          }
        } catch {
          /* ignore */
        }

        setTimeout(() => {
          applyConfirmedImport(io, confirmId, socket).catch((err) => {
            debugError(1, "immediate applyConfirmedImport failed:", err);
            cancelConfirmation(io, confirmId, "apply_failed");
          });
        }, 200);
        return;
      }

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
        deckName: effectiveDeckName,
        save: saveFlag,
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
        debugWarn(1, "importDeck: clearing transient zones failed", e);
      }

      try {
        addPendingInitialDrawFlag(game, pid);
        try {
          broadcastGame(io, game, gameId);
        } catch {
          /* best-effort */
        }
      } catch (e) {
        debugWarn(1, "importDeck: addPendingInitialDrawFlag failed", e);
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
        debugWarn(1, "importDeck: enqueue import wipe confirm failed", err);
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
        debugWarn(1, "importDeck: auto-apply single-player failed", e);
      }
    }
  );
}
