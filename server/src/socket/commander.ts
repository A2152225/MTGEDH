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
import { ensureGame, broadcastGame, emitStateToSocket, parseManaCost, getManaColorName, MANA_COLORS, MANA_COLOR_NAMES, consumeManaFromPool, getOrInitManaPool, calculateTotalAvailableMana, validateManaPayment, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { fetchCardByExactNameStrict } from "../services/scryfall";
import type { PlayerID } from "../../../shared/src";
import { debug, debugWarn, debugError } from "../utils/debug.js";

// Type helper for socket data
interface SocketWithData extends Socket {
  data: {
    playerId?: string;
    spectator?: boolean;
    gameId?: string;
  };
}

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
 * Interface for extracted Scryfall card data used in debug output
 */
interface DebugCardData {
  id?: string;
  name?: string;
  type_line?: string;
  oracle_text?: string;
  mana_cost?: string;
  power?: string;
  toughness?: string;
  image_uris?: Record<string, string>;
  card_faces?: unknown[];
  layout?: string;
  cmc?: number;
  colors?: string[];
  color_identity?: string[];
  keywords?: string[];
  rarity?: string;
  set?: string;
  set_name?: string;
  legalities?: Record<string, string>;
  edhrec_rank?: number;
  produced_mana?: string[];
}

/**
 * Extract Scryfall card data from a card object for debug output.
 * Safely handles missing or malformed data.
 */
function extractScryfallData(card: unknown, includeExtended = false): DebugCardData {
  if (!card || typeof card !== 'object') {
    return {};
  }
  const c = card as Record<string, unknown>;
  
  const baseData: DebugCardData = {
    id: typeof c.id === 'string' ? c.id : undefined,
    name: typeof c.name === 'string' ? c.name : undefined,
    type_line: typeof c.type_line === 'string' ? c.type_line : undefined,
    oracle_text: typeof c.oracle_text === 'string' ? c.oracle_text : undefined,
    mana_cost: typeof c.mana_cost === 'string' ? c.mana_cost : undefined,
    power: typeof c.power === 'string' ? c.power : undefined,
    toughness: typeof c.toughness === 'string' ? c.toughness : undefined,
    image_uris: c.image_uris && typeof c.image_uris === 'object' 
      ? c.image_uris as Record<string, string> : undefined,
    card_faces: Array.isArray(c.card_faces) ? c.card_faces : undefined,
    layout: typeof c.layout === 'string' ? c.layout : undefined,
    cmc: typeof c.cmc === 'number' ? c.cmc : undefined,
    colors: Array.isArray(c.colors) ? c.colors as string[] : undefined,
    color_identity: Array.isArray(c.color_identity) ? c.color_identity as string[] : undefined,
    keywords: Array.isArray(c.keywords) ? c.keywords as string[] : undefined,
    rarity: typeof c.rarity === 'string' ? c.rarity : undefined,
    set: typeof c.set === 'string' ? c.set : undefined,
    set_name: typeof c.set_name === 'string' ? c.set_name : undefined,
  };
  
  // Add extended data for import buffer dumps
  if (includeExtended) {
    baseData.legalities = c.legalities && typeof c.legalities === 'object' 
      ? c.legalities as Record<string, string> : undefined;
    baseData.edhrec_rank = typeof c.edhrec_rank === 'number' ? c.edhrec_rank : undefined;
    baseData.produced_mana = Array.isArray(c.produced_mana) ? c.produced_mana as string[] : undefined;
  }
  
  return baseData;
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
      for (const s of Array.from(io.sockets.sockets.values())) {
        try {
          const sock = s as SocketWithData;
          if (sock?.data?.playerId === pid && !sock?.data?.spectator) {
            sock.emit("importedDeckCandidates", { gameId, candidates });
          }
        } catch {
          /* ignore per-socket errors */
        }
      }
      debug(1, "[commander] emitImportedDeckCandidatesToPlayer", {
        gameId,
        playerId: pid,
        candidatesCount: candidates.length,
      });
    } catch (e) {
      debugWarn(1, 
        "emitImportedDeckCandidatesToPlayer: iterating sockets failed",
        e
      );
    }
  } catch (err) {
    debugError(1, "emitImportedDeckCandidatesToPlayer failed:", err);
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
    for (const s of Array.from(io.sockets.sockets.values())) {
      try {
        const sock = s as SocketWithData;
        if (sock?.data?.playerId === pid && !sock?.data?.spectator) {
          sock.emit("suggestCommanders", payload);
        }
      } catch {
        /* ignore per-socket errors */
      }
    }
    debug(1, "[commander] emitSuggestCommandersToPlayer", {
      gameId,
      playerId: pid,
      names: payload.names,
    });
  } catch (err) {
    debugError(1, "emitSuggestCommandersToPlayer failed:", err);
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
      debug(1, "[commander] setCommander incoming", {
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
          debug(1, "[commander] setCommander local buffer resolution", {
            gameId,
            playerId: pid,
            names,
            resolvedIds,
          });
        } catch (err) {
          debugWarn(1, "setCommander: local import buffer lookup error:", err);
        }

        if (names.length && resolvedIds.filter(Boolean).length < names.length) {
          for (let i = 0; i < names.length; i++) {
            if (resolvedIds[i]) continue;
            const nm = names[i];
            try {
              const card = await fetchCardByExactNameStrict(nm);
              resolvedIds[i] = card && card.id ? card.id : "";
              debug(1, "[commander] setCommander scryfall resolution", {
                gameId,
                playerId: pid,
                name: nm,
                resolvedId: resolvedIds[i],
              });
            } catch (err) {
              debugWarn(1, 
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

      debug(1, "[commander] setCommander idsToApply", {
        gameId,
        playerId: pid,
        names,
        idsToApply,
      });

      // Use the engine's setCommander function which handles all the logic
      try {
        if (typeof (game as any).setCommander === "function") {
          debug(2, `[commander-socket] Calling game.setCommander for player ${pid} with names:`, names, 'ids:', idsToApply);
          
          // Check if we'll do the opening draw (hand empty and pending flag set)
          const pendingSet = (game as any).pendingInitialDraw as Set<string> | undefined;
          const willDoOpeningDraw = pendingSet && pendingSet.has(pid);
          const zonesBefore = game.state?.zones?.[pid];
          const handCountBefore = zonesBefore
            ? (typeof zonesBefore.handCount === "number" ? zonesBefore.handCount : (Array.isArray(zonesBefore.hand) ? zonesBefore.hand.length : 0))
            : 0;
          const doingOpeningDraw = willDoOpeningDraw && handCountBefore === 0;
          
          (game as any).setCommander(pid, names, idsToApply);
          
          try {
            appendEvent(gameId, game.seq, "setCommander", {
              playerId: pid,
              commanderNames: names,
              commanderIds: idsToApply,
            });
            
            // If we did the opening draw (shuffle + draw 7), persist those events for replay
            if (doingOpeningDraw) {
              appendEvent(gameId, game.seq, "shuffleLibrary", { playerId: pid });
              appendEvent(gameId, game.seq, "drawCards", { playerId: pid, count: 7 });
              debug(1, "[commander] Persisted opening draw events (shuffle + draw 7) for player", pid);
            }
          } catch (err) {
            debugWarn(1, "appendEvent(setCommander) failed:", err);
          }
        } else {
          debugError(1, "[commander-socket] game.setCommander is not available on game object!");
          socket.emit("error", {
            message: "Commander functionality not available (engine not loaded)"
          });
          return;
        }
      } catch (err) {
        debugError(1, "[commander-socket] game.setCommander failed:", err);
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
        debug(1, "[DEBUG_CMD] after setCommander", {
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
        debugWarn(1, "[DEBUG_CMD] logging failed", e);
      }

      try {
        broadcastGame(io, game, gameId);
      } catch (err) {
        debugError(1, "setCommander: broadcastGame failed:", err);
      }

      // NEW: Always send a unicast state to the initiating socket as well,
      // so the local client sees its own commander+hand update even if
      // participants' socketIds are stale.
      try {
        emitStateToSocket(io, gameId, socket.id, pid);
      } catch (e) {
        debugWarn(1, "setCommander: emitStateToSocket failed", e);
      }
    } catch (err) {
      debugError(1, "Unhandled error in setCommander handler:", err);
      socket.emit("error", { message: "Failed to set commander" });
    }
  });

  // Cast commander from command zone
  socket.on("castCommander", (payload: { gameId: string; commanderId?: string; commanderNameOrId?: string; payment?: Array<{ permanentId: string; mana: string }> }) => {
    try {
      const { gameId, payment } = payload;
      // Accept both commanderId and commanderNameOrId for backwards compatibility
      let commanderId = payload.commanderId ?? payload.commanderNameOrId;
      
      debug(1, `[castCommander] Received payload:`, { 
        gameId, 
        commanderId: payload.commanderId, 
        commanderNameOrId: payload.commanderNameOrId,
        resolvedCommanderId: commanderId,
        hasPayment: !!payment 
      });
      
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
      if (phaseStr === "" || phaseStr === "pre_game") {
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
        debug(1, `[castCommander] CommanderId not in commanderIds, attempting name resolution:`, {
          commanderId,
          commanderIds: commanderInfo.commanderIds,
          commanderNames
        });
        const nameIndex = commanderNames.findIndex((n: string) => 
          n?.toLowerCase() === commanderId?.toLowerCase()
        );
        if (nameIndex >= 0 && commanderInfo.commanderIds[nameIndex]) {
          const resolvedId = commanderInfo.commanderIds[nameIndex];
          debug(1, `[castCommander] Resolved commander name "${commanderId}" to ID: ${resolvedId}`);
          commanderId = resolvedId;
        } else {
          debugError(1, `[castCommander] Failed to resolve commander:`, {
            commanderId,
            nameIndex,
            commanderIds: commanderInfo.commanderIds,
            commanderNames
          });
          socket.emit("error", {
            code: "INVALID_COMMANDER",
            message: "That is not your commander or commander not found",
          });
          return;
        }
      } else {
        debug(1, `[castCommander] CommanderId ${commanderId} found in commanderIds, no resolution needed`);
      }
      
      // Check if the commander is in the command zone
      const inCommandZone = Array.isArray((commanderInfo as any).inCommandZone) 
        ? (commanderInfo as any).inCommandZone as string[]
        : commanderInfo.commanderIds.slice();
      
      debug(1, `[castCommander] Checking if commander ${commanderId} is in command zone:`, {
        commanderId,
        inCommandZone,
        commanderIds: commanderInfo.commanderIds
      });
      
      if (!commanderId) {
        debugError(1, `[castCommander] CRITICAL: commanderId is undefined after resolution!`, {
          originalPayload: { commanderId: payload.commanderId, commanderNameOrId: payload.commanderNameOrId },
          commanderInfo: { commanderIds: commanderInfo.commanderIds, commanderNames: (commanderInfo as any).commanderNames }
        });
        socket.emit("error", {
          code: "COMMANDER_ID_UNDEFINED",
          message: "Commander ID is undefined - this is a bug. Please report this issue.",
        });
        return;
      }
      
      if (!inCommandZone.includes(commanderId)) {
        debug(1, `[castCommander] Commander ${commanderId} NOT in command zone, rejecting cast`);
        socket.emit("error", {
          code: "COMMANDER_NOT_IN_CZ",
          message: "Commander is not in the command zone (may already be on the stack or battlefield)",
        });
        return;
      }
      
      debug(2, `[castCommander] Commander is in command zone, checking priority`);
      
      // Check priority - only active player can cast spells during their turn
      if (game.state.priority !== pid) {
        debug(1, `[castCommander] Priority check failed: priority=${game.state.priority}, playerId=${pid}`);
        socket.emit("error", {
          code: "NO_PRIORITY",
          message: "You don't have priority",
        });
        return;
      }
      
      debug(2, `[castCommander] Priority check passed, getting commander card details`);
      debug(2, `[castCommander] Looking for commanderId ${commanderId} in commanderCards array:`, commanderInfo.commanderCards);
      
      // Get commander card details
      const commanderCard = commanderInfo.commanderCards?.find((c: any) => c.id === commanderId);
      if (!commanderCard) {
        debugError(1, `[castCommander] Commander card NOT FOUND in commanderCards!`, {
          commanderId,
          commanderCards: commanderInfo.commanderCards,
          commanderIds: commanderInfo.commanderIds
        });
        socket.emit("error", {
          code: "COMMANDER_CARD_NOT_FOUND",
          message: "Commander card details not found",
        });
        return;
      }
      
      debug(2, `[castCommander] Found commander card: ${commanderCard.name}`);
      
      // Parse the mana cost to validate payment
      const manaCost = commanderCard.mana_cost || "";
      const parsedCost = parseManaCost(manaCost);
      
      // Calculate total mana cost including commander tax
      // Use ?? instead of || to properly handle tax of 0
      const commanderTax = (commanderInfo as any).taxById?.[commanderId] ?? commanderInfo.tax ?? 0;
      debug(2, `[castCommander] Commander tax for ${commanderId}: ${commanderTax} (taxById: ${(commanderInfo as any).taxById?.[commanderId]}, total tax: ${commanderInfo.tax})`);
      const totalGeneric = parsedCost.generic + commanderTax;
      const totalColored = parsedCost.colors;
      
      // Get existing mana pool (floating mana from previous spells)
      const existingPool = getOrInitManaPool(game.state, pid);
      
      // Calculate total available mana (existing pool + new payment)
      const totalAvailable = calculateTotalAvailableMana(existingPool, payment);
      
      // Log floating mana if any
      const floatingMana = Object.entries(existingPool).filter(([_, v]) => v > 0).map(([k, v]) => `${v} ${k}`).join(', ');
      if (floatingMana) {
        debug(2, `[castCommander] Floating mana available in pool: ${floatingMana}`);
      }
      
      // Calculate total required cost
      const coloredCostTotal = Object.values(totalColored).reduce((a: number, b: number) => a + b, 0);
      const totalCost = coloredCostTotal + totalGeneric;
      
      debug(2, `[castCommander] Validating mana payment: totalCost=${totalCost}, coloredCostTotal=${coloredCostTotal}, totalGeneric=${totalGeneric}`);
      
      // Validate if total available mana can pay the cost
      if (totalCost > 0) {
        const validationError = validateManaPayment(totalAvailable, totalColored, totalGeneric);
        if (validationError) {
          let errorMsg = `Insufficient mana to cast ${commanderCard.name}.`;
          if (commanderTax > 0) {
            errorMsg += ` (includes {${commanderTax}} commander tax)`;
          }
          errorMsg += ` ${validationError}`;
          debugError(1, `[castCommander] Mana validation failed:`, { validationError, totalAvailable, totalColored, totalGeneric });
          socket.emit("error", {
            code: "INSUFFICIENT_MANA",
            message: errorMsg,
          });
          return;
        }
        debug(2, `[castCommander] Mana validation passed`);
      }
      
      debug(1, `[castCommander] Player ${pid} casting commander ${commanderId} (${commanderCard.name}) in game ${gameId}`);
      debug(1, `[castCommander] Commander info before casting:`, {
        commanderId,
        commanderName: commanderCard.name,
        inCommandZone: (commanderInfo as any).inCommandZone,
        tax: (commanderInfo as any).taxById?.[commanderId] || commanderInfo.tax || 0
      });
      
      debug(2, `[castCommander] About to process payment and cast commander`);
      
      // Handle mana payment: tap permanents to generate mana (adds to pool)
      if (payment && payment.length > 0) {
        debug(2, `[castCommander] Processing payment for ${commanderCard.name}:`, payment);
        
        // Get player's battlefield
        const zones = game.state?.zones?.[pid];
        const battlefield = (zones as any)?.battlefield || game.state?.battlefield?.filter((p: any) => p.controller === pid) || [];
        
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
          debug(2, `[castCommander] Tapped ${(permanent as any).card?.name || permanentId} for ${mana} mana`);
          
          // Add mana to player's mana pool (already initialized via getOrInitManaPool above)
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
            const poolBefore = (game.state.manaPool[pid] as any)[poolKey];
            (game.state.manaPool[pid] as any)[poolKey]++;
            debug(3, `[castCommander] Added ${mana} mana to pool: ${poolKey} ${poolBefore} -> ${(game.state.manaPool[pid] as any)[poolKey]}`);
          } else {
            debugWarn(1, `[castCommander] Unknown mana color: ${mana}`);
          }
        }
      }
      
      debug(2, `[castCommander] Payment processing complete, about to consume mana from pool`);
      
      // Consume mana from pool to pay for the spell
      // This uses both floating mana and newly tapped mana, leaving unspent mana for subsequent spells
      const pool = getOrInitManaPool(game.state, pid);
      debug(2, `[castCommander] Pool before consume:`, pool);
      consumeManaFromPool(pool, totalColored, totalGeneric, '[castCommander]');
      debug(2, `[castCommander] Pool after consume:`, pool);
      
      debug(2, `[castCommander] About to add commander to stack`);
      
      // Add commander to stack (simplified - real implementation would handle costs, targets, etc.)
      try {
        debug(2, `[castCommander] Pushing commander to stack...`);
        if (typeof (game as any).pushStack === "function") {
          const stackItem = {
            id: `stack_${Date.now()}_${commanderId}`,
            controller: pid,
            card: { ...commanderCard, zone: "stack", isCommander: true },
            targets: [],
          };
          debug(2, `[castCommander] Calling game.pushStack with item:`, stackItem);
          (game as any).pushStack(stackItem);
          debug(2, `[castCommander] Successfully pushed to stack via game.pushStack`);
        } else {
          // Fallback: manually add to stack
          debug(2, `[castCommander] game.pushStack not available, using fallback`);
          game.state.stack = game.state.stack || [];
          game.state.stack.push({
            id: `stack_${Date.now()}_${commanderId}`,
            controller: pid,
            card: { ...commanderCard, zone: "stack", isCommander: true },
            targets: [],
          } as any);
          debug(2, `[castCommander] Successfully pushed to stack (fallback), stack length: ${game.state.stack.length}`);
        }
        
        debug(2, `[castCommander] About to call game.castCommander to update tax and command zone`);
        // Update commander tax and remove from command zone
        if (typeof (game as any).castCommander === "function") {
          debug(1, `[castCommander] Calling game.castCommander with playerId: ${pid}, commanderId: ${commanderId}`);
          (game as any).castCommander(pid, commanderId);
          debug(2, `[castCommander] Successfully called game.castCommander`);
        } else {
          debugWarn(1, `[castCommander] game.castCommander function not available - tax may not update correctly`);
        }
        
        // Bump sequence to trigger client update
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
        
        debug(1, `[castCommander] Appending event with playerId: ${pid}, commanderId: ${commanderId}`);
        if (!commanderId) {
          debugError(1, `[castCommander] CRITICAL: Attempting to append castCommander event with undefined commanderId!`, {
            playerId: pid,
            commanderId,
            payload
          });
          throw new Error("Cannot persist castCommander event with undefined commanderId");
        }
        debug(2, `[castCommander] About to append event and broadcast`);
        appendEvent(gameId, game.seq, "castCommander", { playerId: pid, commanderId, payment });
        debug(2, `[castCommander] Event appended successfully`);
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} cast ${commanderCard.name} from the command zone.`,
          ts: Date.now(),
        });
        debug(2, `[castCommander] Chat message emitted`);
        
        debug(2, `[castCommander] About to broadcast game state`);
        broadcastGame(io, game, gameId);
        debug(1, `[castCommander] Successfully cast commander and broadcast game state`);
      } catch (err: any) {
        debugError(1, `[castCommander] Failed to push commander to stack:`, err);
        socket.emit("error", {
          code: "CAST_COMMANDER_FAILED",
          message: err?.message ?? String(err),
        });
      }
    } catch (err: any) {
      debugError(1, `castCommander error:`, err);
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
        debug(2, `[moveCommanderToCommandZone] Removed commander ${commanderId} from battlefield`);
      }
      
      // Remove from stack if present
      const stack = game.state?.stack as any[] || [];
      const stackIdx = stack.findIndex((s: any) => 
        s?.card?.id === commanderId && s?.controller === pid
      );
      if (stackIdx >= 0) {
        stack.splice(stackIdx, 1);
        debug(2, `[moveCommanderToCommandZone] Removed commander ${commanderId} from stack`);
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
      debugError(1, `moveCommanderToCommandZone error:`, err);
      socket.emit("error", {
        code: "MOVE_COMMANDER_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  /**
   * Handle commander zone choice (Rule 903.9a/903.9b):
   * When a commander would change zones to graveyard or exile, its owner may 
   * choose to put it into the command zone instead.
   * 
   * This handler processes the player's decision and moves the commander 
   * to either the chosen destination or the command zone.
   */
  socket.on("commanderZoneChoice", (payload: { 
    gameId: string; 
    commanderId: string; 
    moveToCommandZone: boolean;
  }) => {
    try {
      const { gameId, commanderId, moveToCommandZone } = payload;
      const pid: PlayerID | undefined = socket.data.playerId;
      const spectator = socket.data.spectator;
      
      if (!pid || spectator) {
        socket.emit("error", {
          code: "COMMANDER_ZONE_CHOICE_NOT_PLAYER",
          message: "Spectators cannot make commander zone choices.",
        });
        return;
      }
      
      if (!gameId || !commanderId) {
        socket.emit("error", {
          code: "COMMANDER_ZONE_CHOICE_INVALID",
          message: "Missing gameId or commanderId",
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
      
      // Get pending choices for this player
      const pendingChoices = (game.state as any)?.pendingCommanderZoneChoice?.[pid];
      if (!pendingChoices || !Array.isArray(pendingChoices) || pendingChoices.length === 0) {
        socket.emit("error", {
          code: "NO_PENDING_CHOICE",
          message: "No pending commander zone choice found",
        });
        return;
      }
      
      // Find the specific pending choice for this commander
      const choiceIndex = pendingChoices.findIndex((c: any) => c.commanderId === commanderId);
      if (choiceIndex < 0) {
        socket.emit("error", {
          code: "INVALID_COMMANDER_CHOICE",
          message: "No pending choice for this commander",
        });
        return;
      }
      
      const choice = pendingChoices[choiceIndex];
      const commanderName = choice.commanderName || commanderId;
      const destinationZone = choice.destinationZone; // 'graveyard' or 'exile'
      const card = choice.card;
      
      // Remove this pending choice
      pendingChoices.splice(choiceIndex, 1);
      if (pendingChoices.length === 0) {
        delete (game.state as any).pendingCommanderZoneChoice[pid];
      }
      
      const zones = (game.state as any).zones = (game.state as any).zones || {};
      const playerZones = zones[pid] = zones[pid] || { 
        hand: [], graveyard: [], exile: [], handCount: 0, graveyardCount: 0, libraryCount: 0 
      };
      
      if (moveToCommandZone) {
        // Player chose to move commander to command zone
        const commanderInfo = game.state?.commandZone?.[pid];
        if (commanderInfo) {
          const inCommandZone = (commanderInfo as any).inCommandZone as string[] || [];
          if (!inCommandZone.includes(commanderId)) {
            inCommandZone.push(commanderId);
            (commanderInfo as any).inCommandZone = inCommandZone;
          }
          if (game.state?.commandZone) {
            (game.state.commandZone as any)[pid] = commanderInfo;
          }
        }
        
        const playerName = getPlayerName(game, pid);
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${playerName} moved ${commanderName} to the command zone instead of ${destinationZone}.`,
          ts: Date.now(),
        });
        
        debug(2, `[commanderZoneChoice] ${pid} chose command zone for ${commanderName} (was going to ${destinationZone})`);
        
      } else {
        // Player chose to let commander go to the destination zone
        if (destinationZone === 'graveyard') {
          playerZones.graveyard = playerZones.graveyard || [];
          playerZones.graveyard.push({ ...card, zone: 'graveyard' });
          playerZones.graveyardCount = (playerZones.graveyard || []).length;
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${commanderName} was put into ${pid}'s graveyard.`,
            ts: Date.now(),
          });
          
        } else if (destinationZone === 'exile') {
          playerZones.exile = playerZones.exile || [];
          playerZones.exile.push({ ...card, zone: 'exile' });
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${commanderName} was exiled.`,
            ts: Date.now(),
          });
          
        } else if (destinationZone === 'hand') {
          // Commander goes to owner's hand
          playerZones.hand = playerZones.hand || [];
          playerZones.hand.push({ ...card, zone: 'hand' });
          playerZones.handCount = (playerZones.hand || []).length;
          
          io.to(gameId).emit("chat", {
            id: `m_${Date.now()}`,
            gameId,
            from: "system",
            message: `${commanderName} was returned to ${pid}'s hand.`,
            ts: Date.now(),
          });
          
        } else if (destinationZone === 'library') {
          // Commander goes to owner's library
          const libraryPosition = choice.libraryPosition || 'shuffle'; // 'top', 'bottom', or 'shuffle'
          const lib = (game as any).libraries?.get(pid) || [];
          const cardCopy = { ...card, zone: 'library' };
          
          if (libraryPosition === 'top') {
            lib.unshift(cardCopy);
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${commanderName} was put on top of ${pid}'s library.`,
              ts: Date.now(),
            });
          } else if (libraryPosition === 'bottom') {
            lib.push(cardCopy);
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${commanderName} was put on the bottom of ${pid}'s library.`,
              ts: Date.now(),
            });
          } else {
            // Shuffle into library - use game's shuffleLibrary for deterministic RNG
            lib.push(cardCopy);
            
            // Use game's shuffleLibrary if available for deterministic shuffle
            if (typeof (game as any).shuffleLibrary === "function") {
              // Set the library first so shuffleLibrary can access it
              (game as any).libraries?.set(pid, lib);
              playerZones.libraryCount = lib.length;
              (game as any).shuffleLibrary(pid);
            } else {
              // Fallback: manual shuffle (non-deterministic) and set library
              debugWarn(2, "[commanderZoneChoice] game.shuffleLibrary not available, using Math.random");
              for (let i = lib.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [lib[i], lib[j]] = [lib[j], lib[i]];
              }
              (game as any).libraries?.set(pid, lib);
              playerZones.libraryCount = lib.length;
            }
            io.to(gameId).emit("chat", {
              id: `m_${Date.now()}`,
              gameId,
              from: "system",
              message: `${commanderName} was shuffled into ${pid}'s library.`,
              ts: Date.now(),
            });
          }
          
          // Update library for non-shuffle cases (top/bottom)
          // For shuffle case, library was already set inside the if/else block above
          if (libraryPosition === 'top' || libraryPosition === 'bottom') {
            (game as any).libraries?.set(pid, lib);
            playerZones.libraryCount = lib.length;
          }
        }
        
        debug(2, `[commanderZoneChoice] ${pid} chose to let ${commanderName} go to ${destinationZone}`);
      }
      
      // Bump sequence and broadcast
      if (typeof (game as any).bumpSeq === "function") {
        (game as any).bumpSeq();
      }
      
      appendEvent(gameId, game.seq, "commanderZoneChoice", { 
        playerId: pid, 
        commanderId, 
        moveToCommandZone,
        destinationZone,
      });
      
      broadcastGame(io, game, gameId);
      
    } catch (err: any) {
      debugError(1, `commanderZoneChoice error:`, err);
      socket.emit("error", {
        code: "COMMANDER_ZONE_CHOICE_ERROR",
        message: err?.message ?? String(err),
      });
    }
  });

  // Debug handler: dumpLibrary - emits player's library with Scryfall data
  socket.on("dumpLibrary", ({ gameId }: { gameId: string }) => {
    try {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!gameId || typeof gameId !== "string") {
        socket.emit("debugLibraryDump", { error: "Missing gameId" });
        return;
      }
      
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("debugLibraryDump", { error: "Game not found" });
        return;
      }
      
      // Get library from various possible locations
      let library: unknown[] = [];
      
      // Try ctx.libraries or game.libraries (Map structure)
      const librariesMap = (game as { libraries?: Map<PlayerID, unknown[]> }).libraries;
      if (librariesMap && typeof librariesMap.get === "function" && pid) {
        library = librariesMap.get(pid) || [];
      }
      
      // Fall back to state.zones[pid].library
      if (library.length === 0 && pid && game.state?.zones?.[pid]) {
        const zoneData = game.state.zones[pid] as { library?: unknown[] };
        library = zoneData.library || [];
      }
      
      // Extract Scryfall data from library cards using shared utility
      const libraryWithScryfall = library.map((card, index) => ({
        position: index,
        ...extractScryfallData(card),
      }));
      
      debug(1, "[debug] dumpLibrary", {
        gameId,
        playerId: pid,
        libraryCount: libraryWithScryfall.length,
      });
      
      socket.emit("debugLibraryDump", {
        gameId,
        playerId: pid,
        libraryCount: libraryWithScryfall.length,
        cards: libraryWithScryfall,
      });
    } catch (err) {
      debugError(1, "dumpLibrary handler failed:", err);
      socket.emit("debugLibraryDump", { error: String(err) });
    }
  });
  
  // Debug handler: dumpImportedDeckBuffer - emits full imported deck with Scryfall data
  socket.on("dumpImportedDeckBuffer", ({ gameId }: { gameId: string }) => {
    try {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!gameId || typeof gameId !== "string") {
        socket.emit("debugImportedDeckBuffer", { error: "Missing gameId" });
        return;
      }
      
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("debugImportedDeckBuffer", { error: "Game not found" });
        return;
      }
      
      // Get the imported deck buffer
      const gameWithBuffer = game as { _lastImportedDecks?: Map<PlayerID, unknown[]> };
      const buf = gameWithBuffer._lastImportedDecks;
      let importedCards: unknown[] = [];
      
      if (buf && typeof buf.get === "function" && pid) {
        importedCards = buf.get(pid) || [];
      }
      
      // If no import buffer, fall back to library
      if (importedCards.length === 0) {
        const librariesMap = (game as { libraries?: Map<PlayerID, unknown[]> }).libraries;
        if (librariesMap && typeof librariesMap.get === "function" && pid) {
          importedCards = librariesMap.get(pid) || [];
        }
      }
      
      // Extract full Scryfall data for each card using shared utility (with extended data)
      const cardsWithScryfall = importedCards.map((card) => extractScryfallData(card, true));
      
      debug(1, "[debug] dumpImportedDeckBuffer", {
        gameId,
        playerId: pid,
        cardCount: cardsWithScryfall.length,
      });
      
      socket.emit("debugImportedDeckBuffer", {
        gameId,
        playerId: pid,
        cardCount: cardsWithScryfall.length,
        cards: cardsWithScryfall,
      });
    } catch (err) {
      debugError(1, "dumpImportedDeckBuffer handler failed:", err);
      socket.emit("debugImportedDeckBuffer", { error: String(err) });
    }
  });
  
  // Debug handler: dumpCommanderState - emits commander zone state with Scryfall data
  socket.on("dumpCommanderState", ({ gameId }: { gameId: string }) => {
    try {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!gameId || typeof gameId !== "string") {
        socket.emit("debugCommanderState", { error: "Missing gameId" });
        return;
      }
      
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("debugCommanderState", { error: "Game not found" });
        return;
      }
      
      // Define interface for commander state output
      interface CommanderStateOutput {
        playerName: string;
        commanderIds: readonly string[];
        commanderNames: readonly string[];
        inCommandZone: readonly string[];
        tax: number;
        taxById: Record<string, number>;
        commanderCards: DebugCardData[];
      }
      
      // Get all players' commander states for debugging
      const allCommanderStates: Record<string, CommanderStateOutput> = {};
      const players = game.state?.players || [];
      
      for (const player of players) {
        const playerRecord = player as { id?: string; name?: string };
        const playerId = playerRecord.id;
        if (!playerId) continue;
        
        const commandZone = game.state?.commandZone?.[playerId];
        
        if (commandZone) {
          // Extract full Scryfall data for commander cards using shared utility
          const commanderCards = (commandZone.commanderCards || []).map(
            (card: unknown) => extractScryfallData(card)
          );
          
          const zoneRecord = commandZone as {
            commanderNames?: readonly string[];
            inCommandZone?: readonly string[];
            taxById?: Record<string, number>;
          };
          
          allCommanderStates[playerId] = {
            playerName: playerRecord.name || playerId,
            commanderIds: commandZone.commanderIds || [],
            commanderNames: zoneRecord.commanderNames || [],
            inCommandZone: zoneRecord.inCommandZone || [],
            tax: commandZone.tax || 0,
            taxById: zoneRecord.taxById || {},
            commanderCards,
          };
        }
      }
      
      // Get additional debug info
      const gameWithPending = game as { pendingInitialDraw?: Set<string> | string[] };
      const pendingInitialDraw = gameWithPending.pendingInitialDraw;
      const pendingList: string[] = pendingInitialDraw 
        ? (pendingInitialDraw instanceof Set 
            ? Array.from(pendingInitialDraw.values()) 
            : Array.isArray(pendingInitialDraw) 
              ? pendingInitialDraw 
              : [])
        : [];
      
      debug(1, "[debug] dumpCommanderState", {
        gameId,
        playerId: pid,
        playerCount: Object.keys(allCommanderStates).length,
      });
      
      socket.emit("debugCommanderState", {
        gameId,
        requestingPlayer: pid,
        phase: game.state?.phase,
        turn: game.state?.turn,
        priority: game.state?.priority,
        turnPlayer: game.state?.turnPlayer,
        format: game.state?.format,
        pendingInitialDraw: pendingList,
        commanderStates: allCommanderStates,
      });
    } catch (err) {
      debugError(1, "dumpCommanderState handler failed:", err);
      socket.emit("debugCommanderState", { error: String(err) });
    }
  });
}

