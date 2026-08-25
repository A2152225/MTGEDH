/**
 * Origin parent: server/src/socket/interaction.ts
 * Cluster moved: exchangeTextBoxes and sacrificePermanent sockets.
 * Public entry symbols: handleExchangeTextBoxesRequest, handleSacrificePermanentRequest.
 */
import type { Server, Socket } from "socket.io";
import type { PlayerID } from "../../../../shared/src/index.js";
import { appendEvent } from "../../db";
import { ResolutionQueueManager, ResolutionStepType } from "../../state/resolution/index.js";
import { exchangePermanentOracleText } from "../../state/utils";
import { movePermanentToGraveyard, trackPermanentSacrificedThisTurn } from "../../state/modules/counters_tokens.js";
import { queueSacrificeTriggers } from "../../state/modules/triggers/sacrifice.js";
import { sacrificePermanent } from "../../state/modules/upkeep-triggers.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { filterLibraryCardsForSearch } from "../library-search.js";
import { broadcastGame, getPlayerName } from "../util";
import type { EnsureInRoomAndSeated } from "./interactionRoomAndBattlefield.js";
import { parseSearchCriteria } from "./interactionTutorSearchCriteriaParsing.js";

// Exchange oracle text boxes between two permanents (text-changing effects)
export async function handleExchangeTextBoxesRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  payload?: { gameId?: unknown; sourcePermanentId?: unknown; targetPermanentId?: unknown },
): Promise<void> {
    const gameIdRaw = payload?.gameId;
    const sourcePermanentId = payload?.sourcePermanentId;
    const targetPermanentId = payload?.targetPermanentId;

    if (typeof sourcePermanentId !== "string" || typeof targetPermanentId !== "string") return;

    const ctx = ensureInRoomAndSeated(gameIdRaw);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;
  const battlefield = game.state?.battlefield || [];

  const source = battlefield.find((p: any) => p?.id === sourcePermanentId);
  const target = battlefield.find((p: any) => p?.id === targetPermanentId);

  if (!source || !target) {
    socket.emit("error", { code: "PERMANENT_NOT_FOUND", message: "One or both permanents not found" });
    return;
  }

  if (source.controller !== pid) {
    socket.emit("error", { code: "NOT_CONTROLLER", message: "You must control the source permanent to exchange text boxes" });
    return;
  }

  const exchanged = exchangePermanentOracleText(battlefield, sourcePermanentId, targetPermanentId);
  if (!exchanged) {
    socket.emit("error", { code: "EXCHANGE_FAILED", message: "Could not exchange oracle text between permanents" });
    return;
  }

  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }

  appendEvent(gameId, (game as any).seq ?? 0, "exchangeTextBoxes", {
    playerId: pid,
    sourcePermanentId,
    targetPermanentId,
  });

  const sourceName = source?.card?.name || "Unknown";
  const targetName = target?.card?.name || "Unknown";
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} exchanged text boxes of ${sourceName} and ${targetName}.`,
    ts: Date.now(),
  });

  broadcastGame(io, game, gameId);
}

// Sacrifice a permanent on the battlefield
export async function handleSacrificePermanentRequest(
  io: Server,
  socket: Socket,
  ensureInRoomAndSeated: EnsureInRoomAndSeated,
  payload?: { gameId?: unknown; permanentId?: unknown },
): Promise<void> {
    const gameIdRaw = payload?.gameId;
    const permanentId = payload?.permanentId;

    if (!permanentId || typeof permanentId !== "string") return;

    const ctx = ensureInRoomAndSeated(gameIdRaw);
    if (!ctx) return;

    const { gameId, game, pid } = ctx;
    const battlefield = game.state?.battlefield || [];
  
  const permIndex = battlefield.findIndex((p: any) => p?.id === permanentId && p?.controller === pid);
  if (permIndex === -1) {
    socket.emit("error", {
      code: "PERMANENT_NOT_FOUND",
      message: "Permanent not found or not controlled by you",
    });
    return;
  }
  
  const permanent = battlefield[permIndex];
  const card = (permanent as any).card;
  const cardName = card?.name || "Unknown";
  const oracleText = (card?.oracle_text || "").toLowerCase();
  const typeLine = (card?.type_line || "").toLowerCase();
  const isCreature = typeLine.includes("creature");
  const isLand = typeLine.includes("land");
  
  // Check if this is a fetch land or similar with search effect
  // IMPORTANT: Only lands that specifically search for land cards should trigger library search
  // Creatures like Magda, Brazen Outlaw search for artifacts/dragons, not lands
  const searchesForLand = oracleText.includes("land card") || 
    oracleText.match(/search[^.]*for[^.]*(?:forest|plains|island|swamp|mountain)/) !== null;
  const isFetchLand = isLand && !isCreature && 
    oracleText.includes("sacrifice") && 
    oracleText.includes("search your library") &&
    searchesForLand;
  
  // Cleanup Equipment/Fortification attachments if this attachment is leaving battlefield
  const isEquipment = typeLine.includes("equipment");
  const isFortification = typeLine.includes("fortification");
  const isAttachmentPermanent = isEquipment || isFortification;
  if (isAttachmentPermanent && permanent.attachedTo) {
    const attachedPermanent = battlefield.find((p: any) => p?.id === permanent.attachedTo);
    if (attachedPermanent && attachedPermanent.attachedEquipment) {
      attachedPermanent.attachedEquipment = (attachedPermanent.attachedEquipment as string[]).filter(
        (id: string) => id !== permanentId
      );
      if (attachedPermanent.attachedEquipment.length === 0) {
        attachedPermanent.isEquipped = false;
      }
    }
  }
  
  // Cleanup attached equipment/fortifications if this permanent is leaving battlefield
  if (permanent.attachedEquipment && permanent.attachedEquipment.length > 0) {
    for (const equipId of permanent.attachedEquipment as string[]) {
      const equipment = battlefield.find((p: any) => p?.id === equipId);
      if (equipment) {
        equipment.attachedTo = undefined;
      }
    }
  }
  
  trackPermanentSacrificedThisTurn(game.state, permanent);

  try {
    queueSacrificeTriggers(game as any, String(pid), permanent);
  } catch (err) {
    debugWarn(1, '[sacrificePermanent] Failed to queue sacrifice triggers:', err);
  }

  const moved = movePermanentToGraveyard(game as any, String(permanentId), true);
  if (!moved) {
    socket.emit("error", {
      code: "PERMANENT_NOT_FOUND",
      message: "Permanent no longer on battlefield",
    });
    return;
  }
  
  appendEvent(gameId, (game as any).seq ?? 0, "sacrificePermanent", { playerId: pid, permanentId });

  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} sacrificed ${cardName}.`,
    ts: Date.now(),
  });
  
  // If this was a fetch land, trigger library search
  if (isFetchLand) {
    // Check if it's a true fetch (pay 1 life) - note life was not paid since this is manual sacrifice
    const isTrueFetch = oracleText.includes("pay 1 life");
    
    if (isTrueFetch) {
      // Notify that the player should have paid life
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `Note: ${cardName} requires paying 1 life to search (use Fetch Land ability for automatic life payment).`,
        ts: Date.now(),
      });
    }
    
    // Parse what land types this fetch can find
    const filter = parseSearchCriteria(oracleText);
    
    // Build description for the search prompt
    let searchDescription = "Search your library for a land card";
    if (filter.subtypes && filter.subtypes.length > 0) {
      const landTypes = filter.subtypes.filter(s => !s.includes("basic")).map(s => s.charAt(0).toUpperCase() + s.slice(1));
      if (landTypes.length > 0) {
        searchDescription = `Search for a ${landTypes.join(" or ")} card`;
      }
      if (filter.subtypes.includes("basic")) {
        searchDescription = `Search for a basic ${landTypes.join(" or ")} card`;
      }
    }
    
    // Get full library for search
    const library = game.searchLibrary ? game.searchLibrary(pid, "", 1000) : [];
    
    // Queue library search via Resolution Queue
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.LIBRARY_SEARCH,
      playerId: pid as PlayerID,
      sourceName: `${cardName}`,
      description: searchDescription,
      searchCriteria: searchDescription,
      minSelections: 0,
      maxSelections: 1,
      mandatory: false,
      destination: 'battlefield',
      reveal: false,
      shuffleAfter: true,
      availableCards: filterLibraryCardsForSearch(library, filter, game.state, pid),
      filter,
      entersTapped: false,
    } as any);
  }
  
  broadcastGame(io, game, gameId);
}
