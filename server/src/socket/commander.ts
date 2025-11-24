/**
 * server/src/socket/commander.ts
 *
 * Socket handlers for commander operations.
 *
 * Key points in this variant:
 * - Treat client-provided ids as input but always read back authoritative state from game.state.
 * - Resolve names -> ids only for names the client supplied (local import buffer -> scryfall fallback).
 * - Update zones[pid].libraryCount from authoritative libraries map if present so clients see correct counts.
 * - Perform pendingInitialDraw idempotently: only shuffle/draw when the player's hand is empty; clear pending flag.
 * - Provide debug endpoints to inspect library, import buffer, and commander state.
 *
 * Additional:
 * - Enforce replace semantics when the client provides ids (do not implicitly merge into partner slots).
 * - Export helpers to push candidate/suggestion events to all sockets belonging to a player (fixes importer-socket races).
 */

import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, emitStateToSocket } from "./util";
import { appendEvent } from "../db";
import { fetchCardByExactNameStrict } from "../services/scryfall";
import type { PlayerID } from "../../shared/src";

function normalizeNamesArray(payload: any): string[] {
  if (!payload) return [];
  if (Array.isArray(payload.commanderNames)) return payload.commanderNames.slice();
  if (Array.isArray(payload.names)) return payload.names.slice();
  if (typeof payload.commanderNames === "string") return [payload.commanderNames];
  if (typeof payload.names === "string") return [payload.names];
  if (typeof payload.name === "string") return [payload.name];
  return [];
}

/**
 * Helper: build minimal KnownCardRef-like objects from an array of card objects
 */
function makeCandidateList(arr: any[] | undefined) {
  const out = (arr || []).map((c: any) => ({
    id: c?.id || c?.cardId || null,
    name: c?.name || c?.cardName || null,
    image_uris:
      c?.image_uris ||
      c?.imageUris ||
      (c?.scryfall && c.scryfall.image_uris) ||
      null,
  }));
  return out;
}

/**
 * Emit importedDeckCandidates to all currently-connected sockets that belong to `pid` (non-spectators).
 */
export function emitImportedDeckCandidatesToPlayer(
  io: Server,
  gameId: string,
  pid: PlayerID
) {
  try {
    const game = ensureGame(gameId);
    if (!game) return;
    const buf = (game as any)._lastImportedDecks as
      | Map<PlayerID, any[]>
      | undefined;
    let localArr: any[] = [];
    if (buf && typeof buf.get === "function") localArr = buf.get(pid) || [];
    else if ((game as any).libraries && Array.isArray((game as any).libraries[pid]))
      localArr = (game as any).libraries[pid] || [];

    const candidates = makeCandidateList(localArr);

    try {
      for (const s of Array.from(io.sockets.sockets.values() as any)) {
        try {
          if (s?.data?.playerId === pid && !s?.data?.spectator) {
            s.emit("importedDeckCandidates", { gameId, candidates });
          }
        } catch {
          /* ignore per-socket errors */
        }
      }
      console.info("[commander] emitImportedDeckCandidatesToPlayer", {
        gameId,
        playerId: pid,
        candidatesCount: candidates.length,
      });
    } catch (e) {
      console.warn(
        "emitImportedDeckCandidatesToPlayer: iterating sockets failed",
        e
      );
    }
  } catch (err) {
    console.error("emitImportedDeckCandidatesToPlayer failed:", err);
  }
}

/**
 * Emit suggestCommanders to all currently-connected sockets that belong to `pid`.
 */
export function emitSuggestCommandersToPlayer(
  io: Server,
  gameId: string,
  pid: PlayerID,
  names?: string[]
) {
  try {
    const payload = {
      gameId,
      names: Array.isArray(names) ? names.slice(0, 2) : [],
    };
    for (const s of Array.from(io.sockets.sockets.values() as any)) {
      try {
        if (s?.data?.playerId === pid && !s?.data?.spectator) {
          s.emit("suggestCommanders", payload);
        }
      } catch {
        /* ignore per-socket errors */
      }
    }
    console.info("[commander] emitSuggestCommandersToPlayer", {
      gameId,
      playerId: pid,
      names: payload.names,
    });
  } catch (err) {
    console.error("emitSuggestCommandersToPlayer failed:", err);
  }
}

export function registerCommanderHandlers(io: Server, socket: Socket) {
  socket.on("setCommander", async (payload: any) => {
    try {
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;
      if (!pid || spectator) {
        socket.emit("deckError", {
          gameId: payload?.gameId,
          message: "Spectators cannot set commander.",
        });
        return;
      }
      if (!payload || !payload.gameId) {
        socket.emit("error", { message: "Missing gameId for setCommander" });
        return;
      }

      const gameId = payload.gameId;
      console.info("[commander] setCommander incoming", {
        gameId,
        from: pid,
        commanderNames: payload.commanderNames || payload.names,
        commanderIds: payload.commanderIds || payload.ids,
      });

      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { message: "Game not found" });
        return;
      }

      const names: string[] = normalizeNamesArray(payload);

      let providedIds: string[] = Array.isArray(payload.commanderIds)
        ? payload.commanderIds.slice()
        : Array.isArray(payload.ids)
        ? payload.ids.slice()
        : [];

      const resolvedIds: string[] = [];
      if ((!providedIds || providedIds.length === 0) && names.length > 0) {
        try {
          const buf = (game as any)._lastImportedDecks as
            | Map<PlayerID, any[]>
            | undefined;
          if (buf && buf.get(pid)) {
            const local = buf.get(pid) || [];
            const map = new Map<string, string>();
            for (const c of local) {
              if (c && c.name && c.id) {
                const key = String(c.name).trim().toLowerCase();
                if (!map.has(key)) map.set(key, c.id);
              }
            }
            for (let i = 0; i < names.length; i++) {
              const key = String(names[i]).trim().toLowerCase();
              resolvedIds[i] = map.get(key) || "";
            }
          }
          console.info("[commander] setCommander local buffer resolution", {
            gameId,
            playerId: pid,
            names,
            resolvedIds,
          });
        } catch (err) {
          console.warn("setCommander: local import buffer lookup error:", err);
        }

        if (names.length && resolvedIds.filter(Boolean).length < names.length) {
          for (let i = 0; i < names.length; i++) {
            if (resolvedIds[i]) continue;
            const nm = names[i];
            try {
              const card = await fetchCardByExactNameStrict(nm);
              resolvedIds[i] = card && card.id ? card.id : "";
              console.info("[commander] setCommander scryfall resolution", {
                gameId,
                playerId: pid,
                name: nm,
                resolvedId: resolvedIds[i],
              });
            } catch (err) {
              console.warn(
                `setCommander: scryfall resolution failed for "${nm}"`,
                err
              );
              resolvedIds[i] = "";
            }
          }
        }
      }

      const idsToApply =
        providedIds && providedIds.length > 0
          ? providedIds.filter(Boolean)
          : (resolvedIds || []).filter(Boolean);

      console.info("[commander] setCommander idsToApply", {
        gameId,
        playerId: pid,
        names,
        idsToApply,
      });

      // Use the engine's setCommander function which handles all the logic
      try {
        if (typeof (game as any).setCommander === "function") {
          console.log(`[commander-socket] Calling game.setCommander for player ${pid} with names:`, names, 'ids:', idsToApply);
          (game as any).setCommander(pid, names, idsToApply);
          
          try {
            appendEvent(gameId, game.seq, "setCommander", {
              playerId: pid,
              commanderNames: names,
              commanderIds: idsToApply,
            });
          } catch (err) {
            console.warn("appendEvent(setCommander) failed:", err);
          }
        } else {
          console.error("[commander-socket] game.setCommander is not available on game object!");
          socket.emit("error", {
            message: "Commander functionality not available (engine not loaded)"
          });
          return;
        }
      } catch (err) {
        console.error("[commander-socket] game.setCommander failed:", err);
        socket.emit("error", {
          message: `Failed to set commander: ${err}`
        });
        return;
      }

      // Compact debug log of commander + top-of-library state after all changes
      try {
        const cz =
          (game.state &&
            (game.state as any).commandZone &&
            (game.state as any).commandZone[pid]) ||
          null;
        const z =
          (game.state &&
            (game.state as any).zones &&
            (game.state as any).zones[pid]) ||
          null;
        const libArr = z && Array.isArray(z.library) ? z.library : [];
        const top = libArr[0];
        console.info("[DEBUG_CMD] after setCommander", {
          gameId,
          playerId: pid,
          commanderIds: cz?.commanderIds,
          commanderNames: cz?.commanderNames,
          libraryCount: z?.libraryCount,
          libraryTop: top
            ? {
                id: top.id,
                name: top.name,
                type_line: top.type_line,
              }
            : null,
        });
      } catch (e) {
        console.warn("[DEBUG_CMD] logging failed", e);
      }

      try {
        broadcastGame(io, game, gameId);
      } catch (err) {
        console.error("setCommander: broadcastGame failed:", err);
      }

      // NEW: Always send a unicast state to the initiating socket as well,
      // so the local client sees its own commander+hand update even if
      // participants' socketIds are stale.
      try {
        emitStateToSocket(io, gameId, socket.id, pid);
      } catch (e) {
        console.warn("setCommander: emitStateToSocket failed", e);
      }
    } catch (err) {
      console.error("Unhandled error in setCommander handler:", err);
      socket.emit("error", { message: "Failed to set commander" });
    }
  });

  // Cast commander from command zone
  socket.on("castCommander", (payload: { gameId: string; commanderId?: string; commanderNameOrId?: string }) => {
    try {
      const { gameId } = payload;
      // Accept both commanderId and commanderNameOrId for backwards compatibility
      let commanderId = payload.commanderId ?? payload.commanderNameOrId;
      
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;
      
      if (!pid || spectator) {
        socket.emit("error", {
          code: "CAST_COMMANDER_NOT_PLAYER",
          message: "Spectators cannot cast commanders.",
        });
        return;
      }
      
      if (!gameId || !commanderId) {
        socket.emit("error", {
          code: "CAST_COMMANDER_INVALID",
          message: "Missing gameId or commanderId/commanderNameOrId",
        });
        return;
      }
      
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", {
          code: "GAME_NOT_FOUND",
          message: "Game not found",
        });
        return;
      }
      
      // Get commander info to validate and resolve name if needed
      const commanderInfo = game.state?.commandZone?.[pid];
      if (!commanderInfo || !commanderInfo.commanderIds || commanderInfo.commanderIds.length === 0) {
        socket.emit("error", {
          code: "INVALID_COMMANDER",
          message: "No commander set for this player",
        });
        return;
      }
      
      // If commanderId is a name, try to resolve it to an id
      if (!commanderInfo.commanderIds.includes(commanderId)) {
        // Try to find by name
        const commanderNames = (commanderInfo as any).commanderNames || [];
        const nameIndex = commanderNames.findIndex((n: string) => 
          n?.toLowerCase() === commanderId?.toLowerCase()
        );
        if (nameIndex >= 0 && commanderInfo.commanderIds[nameIndex]) {
          commanderId = commanderInfo.commanderIds[nameIndex];
        } else {
          socket.emit("error", {
            code: "INVALID_COMMANDER",
            message: "That is not your commander or commander not found",
          });
          return;
        }
      }
      
      // Check priority - only active player can cast spells during their turn
      if (game.state.priority !== pid) {
        socket.emit("error", {
          code: "NO_PRIORITY",
          message: "You don't have priority",
        });
        return;
      }
      
      // Get commander card details
      const commanderCard = commanderInfo.commanderCards?.find((c: any) => c.id === commanderId);
      if (!commanderCard) {
        socket.emit("error", {
          code: "COMMANDER_CARD_NOT_FOUND",
          message: "Commander card details not found",
        });
        return;
      }
      
      console.info(`[castCommander] Player ${pid} casting commander ${commanderId} (${commanderCard.name}) in game ${gameId}`);
      
      // Add commander to stack (simplified - real implementation would handle costs, targets, etc.)
      try {
        if (typeof (game as any).pushStack === "function") {
          const stackItem = {
            id: `stack_${Date.now()}_${commanderId}`,
            controller: pid,
            card: { ...commanderCard, zone: "stack" },
            targets: [],
          };
          (game as any).pushStack(stackItem);
        } else {
          // Fallback: manually add to stack
          game.state.stack = game.state.stack || [];
          game.state.stack.push({
            id: `stack_${Date.now()}_${commanderId}`,
            controller: pid,
            card: { ...commanderCard, zone: "stack" },
            targets: [],
          } as any);
        }
        
        // Update commander tax
        if (typeof (game as any).castCommander === "function") {
          (game as any).castCommander(pid, commanderId);
        }
        
        // Bump sequence to trigger client update
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
        
        appendEvent(gameId, game.seq, "castCommander", { playerId: pid, commanderId });
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${pid} cast ${commanderCard.name} from the command zone.`,
          ts: Date.now(),
        });
        
        broadcastGame(io, game, gameId);
      } catch (err: any) {
        console.error(`[castCommander] Failed to push commander to stack:`, err);
        socket.emit("error", {
          code: "CAST_COMMANDER_FAILED",
          message: err?.message ?? String(err),
        });
      }
    } catch (err: any) {
      console.error(`castCommander error for game ${gameId}:`, err);
      socket.emit("error", {
        code: "CAST_COMMANDER_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // dumpLibrary, dumpImportedDeckBuffer, getImportedDeckCandidates, dumpCommanderState
  // remain as in your current file (not shown here for brevity).
}