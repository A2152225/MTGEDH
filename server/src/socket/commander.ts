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
import { ensureGame, broadcastGame, emitStateToSocket, parseManaCost } from "./util";
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
  socket.on("castCommander", (payload: { gameId: string; commanderId?: string; commanderNameOrId?: string; payment?: Array<{ permanentId: string; mana: string }> }) => {
    try {
      const { gameId, payment } = payload;
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
      
      // Check if we're in PRE_GAME phase - spells cannot be cast during pre-game
      const phaseStr = String(game.state?.phase || "").toUpperCase().trim();
      if (phaseStr === "" || phaseStr === "PRE_GAME") {
        socket.emit("error", {
          code: "PREGAME_NO_CAST",
          message: "Cannot cast commander during pre-game. Start the game first by claiming turn and advancing to main phase.",
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
      
      // Check if the commander is in the command zone
      const inCommandZone = (commanderInfo as any).inCommandZone as string[] || commanderInfo.commanderIds.slice();
      if (!inCommandZone.includes(commanderId)) {
        socket.emit("error", {
          code: "COMMANDER_NOT_IN_CZ",
          message: "Commander is not in the command zone (may already be on the stack or battlefield)",
        });
        return;
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
      
      // Parse the mana cost to validate payment
      const manaCost = commanderCard.mana_cost || "";
      const parsedCost = parseManaCost(manaCost);
      
      // Calculate total mana cost including commander tax
      const commanderTax = (commanderInfo as any).taxById?.[commanderId] || commanderInfo.tax || 0;
      const totalGeneric = parsedCost.generic + commanderTax;
      const totalColored = parsedCost.colors;
      
      // Calculate what payment provides
      const paymentColors: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 };
      if (payment && payment.length > 0) {
        for (const p of payment) {
          paymentColors[p.mana] = (paymentColors[p.mana] || 0) + 1;
        }
      }
      
      // Check if payment is sufficient
      let totalPaidMana = 0;
      const missingColors: string[] = [];
      
      // First check colored requirements
      for (const color of ['W', 'U', 'B', 'R', 'G', 'C'] as const) {
        const needed = totalColored[color] || 0;
        const provided = paymentColors[color] || 0;
        if (provided < needed) {
          missingColors.push(`${needed - provided} ${color === 'W' ? 'white' : color === 'U' ? 'blue' : color === 'B' ? 'black' : color === 'R' ? 'red' : color === 'G' ? 'green' : 'colorless'}`);
        }
        totalPaidMana += provided;
      }
      
      // Check generic mana (includes commander tax)
      const coloredCostTotal = Object.values(totalColored).reduce((a: number, b: number) => a + b, 0);
      const leftoverManaForGeneric = totalPaidMana - coloredCostTotal;
      const missingGeneric = Math.max(0, totalGeneric - leftoverManaForGeneric);
      
      // Validate payment - commander has a base cost (even if {0}) plus commander tax
      const totalCost = coloredCostTotal + totalGeneric;
      if (totalCost > 0) {
        if (missingColors.length > 0 || missingGeneric > 0) {
          let errorMsg = `Insufficient mana to cast ${commanderCard.name}.`;
          if (commanderTax > 0) {
            errorMsg += ` (includes {${commanderTax}} commander tax)`;
          }
          if (missingColors.length > 0) {
            errorMsg += ` Missing: ${missingColors.join(', ')}.`;
          }
          if (missingGeneric > 0) {
            errorMsg += ` Missing ${missingGeneric} generic mana.`;
          }
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: errorMsg,
          });
          return;
        }
      }
      
      console.info(`[castCommander] Player ${pid} casting commander ${commanderId} (${commanderCard.name}) in game ${gameId}`);
      
      // Handle mana payment: tap permanents to generate mana
      if (payment && payment.length > 0) {
        console.log(`[castCommander] Processing payment for ${commanderCard.name}:`, payment);
        
        // Get player's battlefield
        const zones = game.state?.zones?.[pid];
        const battlefield = zones?.battlefield || game.state?.battlefield?.filter((p: any) => p.controller === pid) || [];
        
        // Process each payment item: tap the permanent and add mana to pool
        for (const { permanentId, mana } of payment) {
          // Search in global battlefield (the structure may be flat)
          const globalBattlefield = game.state?.battlefield || [];
          const permanent = globalBattlefield.find((p: any) => p?.id === permanentId && p?.controller === pid);
          
          if (!permanent) {
            socket.emit("error", {
              code: "PAYMENT_SOURCE_NOT_FOUND",
              message: `Permanent ${permanentId} not found on battlefield`,
            });
            return;
          }
          
          if ((permanent as any).tapped) {
            socket.emit("error", {
              code: "PAYMENT_SOURCE_TAPPED",
              message: `${(permanent as any).card?.name || 'Permanent'} is already tapped`,
            });
            return;
          }
          
          // Tap the permanent
          (permanent as any).tapped = true;
          console.log(`[castCommander] Tapped ${(permanent as any).card?.name || permanentId} for ${mana} mana`);
          
          // Add mana to player's mana pool (initialize if needed)
          game.state.manaPool = game.state.manaPool || {};
          game.state.manaPool[pid] = game.state.manaPool[pid] || {
            white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0
          };
          
          // Map mana color to pool property
          const manaColorMap: Record<string, string> = {
            'W': 'white',
            'U': 'blue',
            'B': 'black',
            'R': 'red',
            'G': 'green',
            'C': 'colorless',
          };
          
          const poolKey = manaColorMap[mana];
          if (poolKey) {
            (game.state.manaPool[pid] as any)[poolKey]++;
          }
        }
      }
      
      // Add commander to stack (simplified - real implementation would handle costs, targets, etc.)
      try {
        if (typeof (game as any).pushStack === "function") {
          const stackItem = {
            id: `stack_${Date.now()}_${commanderId}`,
            controller: pid,
            card: { ...commanderCard, zone: "stack", isCommander: true },
            targets: [],
          };
          (game as any).pushStack(stackItem);
        } else {
          // Fallback: manually add to stack
          game.state.stack = game.state.stack || [];
          game.state.stack.push({
            id: `stack_${Date.now()}_${commanderId}`,
            controller: pid,
            card: { ...commanderCard, zone: "stack", isCommander: true },
            targets: [],
          } as any);
        }
        
        // Update commander tax and remove from command zone
        if (typeof (game as any).castCommander === "function") {
          (game as any).castCommander(pid, commanderId);
        }
        
        // Bump sequence to trigger client update
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
        
        appendEvent(gameId, game.seq, "castCommander", { playerId: pid, commanderId, payment });
        
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

  // Move commander back to command zone (e.g., when it would go to graveyard/exile)
  socket.on("moveCommanderToCommandZone", (payload: { gameId: string; commanderNameOrId: string }) => {
    try {
      const { gameId, commanderNameOrId } = payload;
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;
      
      if (!pid || spectator) {
        socket.emit("error", {
          code: "MOVE_COMMANDER_NOT_PLAYER",
          message: "Spectators cannot move commanders.",
        });
        return;
      }
      
      if (!gameId || !commanderNameOrId) {
        socket.emit("error", {
          code: "MOVE_COMMANDER_INVALID",
          message: "Missing gameId or commanderNameOrId",
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
      
      // Get commander info
      const commanderInfo = game.state?.commandZone?.[pid];
      if (!commanderInfo || !commanderInfo.commanderIds || commanderInfo.commanderIds.length === 0) {
        socket.emit("error", {
          code: "INVALID_COMMANDER",
          message: "No commander set for this player",
        });
        return;
      }
      
      // Resolve name to id if needed
      let commanderId = commanderNameOrId;
      if (!commanderInfo.commanderIds.includes(commanderId)) {
        const commanderNames = (commanderInfo as any).commanderNames || [];
        const nameIndex = commanderNames.findIndex((n: string) => 
          n?.toLowerCase() === commanderId?.toLowerCase()
        );
        if (nameIndex >= 0 && commanderInfo.commanderIds[nameIndex]) {
          commanderId = commanderInfo.commanderIds[nameIndex];
        } else {
          socket.emit("error", {
            code: "INVALID_COMMANDER",
            message: "That is not your commander",
          });
          return;
        }
      }
      
      // Get commander card details
      const commanderCard = commanderInfo.commanderCards?.find((c: any) => c.id === commanderId);
      const commanderName = commanderCard?.name || commanderId;
      
      // Check if commander is already in command zone
      const inCommandZone = (commanderInfo as any).inCommandZone as string[] || [];
      if (inCommandZone.includes(commanderId)) {
        socket.emit("error", {
          code: "COMMANDER_ALREADY_IN_CZ",
          message: "Commander is already in the command zone",
        });
        return;
      }
      
      // Move commander back to command zone
      if (typeof (game as any).moveCommanderToCZ === "function") {
        (game as any).moveCommanderToCZ(pid, commanderId);
      } else {
        // Fallback: manually update inCommandZone
        if (!inCommandZone.includes(commanderId)) {
          inCommandZone.push(commanderId);
          (commanderInfo as any).inCommandZone = inCommandZone;
        }
        if (game.state?.commandZone) {
          (game.state.commandZone as any)[pid] = commanderInfo;
        }
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
      }
      
      // Remove commander from battlefield if present
      const battlefield = game.state?.battlefield as any[] || [];
      const bfIdx = battlefield.findIndex((p: any) => 
        p?.card?.id === commanderId && p?.controller === pid
      );
      if (bfIdx >= 0) {
        battlefield.splice(bfIdx, 1);
        console.log(`[moveCommanderToCommandZone] Removed commander ${commanderId} from battlefield`);
      }
      
      // Remove from stack if present
      const stack = game.state?.stack as any[] || [];
      const stackIdx = stack.findIndex((s: any) => 
        s?.card?.id === commanderId && s?.controller === pid
      );
      if (stackIdx >= 0) {
        stack.splice(stackIdx, 1);
        console.log(`[moveCommanderToCommandZone] Removed commander ${commanderId} from stack`);
      }
      
      appendEvent(gameId, game.seq, "moveCommanderToCZ", { playerId: pid, commanderId });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${pid} moved ${commanderName} to the command zone.`,
        ts: Date.now(),
      });
      
      broadcastGame(io, game, gameId);
    } catch (err: any) {
      console.error(`moveCommanderToCommandZone error:`, err);
      socket.emit("error", {
        code: "MOVE_COMMANDER_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // dumpLibrary, dumpImportedDeckBuffer, getImportedDeckCandidates, dumpCommanderState
  // remain as in your current file (not shown here for brevity).
}