import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";

/**
 * Creature type selection handlers
 * 
 * Used for cards that require choosing a creature type as they enter the battlefield:
 * - Morophon, the Boundless
 * - Kindred Discovery
 * - Coat of Arms (for effects)
 * - Cavern of Souls
 * etc.
 */

/**
 * Pending creature type selection requests
 * Key: confirmId
 */
interface PendingCreatureTypeSelection {
  gameId: string;
  playerId: string;
  permanentId: string;
  cardName: string;
  reason: string;
  timeout: NodeJS.Timeout | null;
}

const pendingSelections: Map<string, PendingCreatureTypeSelection> = new Map();

/**
 * Create a unique confirmation ID
 */
function createConfirmId(): string {
  return `ct_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Request a creature type selection from a player
 */
export function requestCreatureTypeSelection(
  io: Server,
  gameId: string,
  playerId: string,
  permanentId: string,
  cardName: string,
  reason: string
): string {
  // Check if there's already a pending selection for this permanent
  for (const [existingConfirmId, pending] of pendingSelections.entries()) {
    if (pending.permanentId === permanentId && pending.gameId === gameId) {
      console.log(`[creatureType] Selection already pending for ${cardName} (${existingConfirmId}), skipping duplicate request`);
      return existingConfirmId;
    }
  }
  
  const confirmId = createConfirmId();
  
  // Store pending selection
  const pending: PendingCreatureTypeSelection = {
    gameId,
    playerId,
    permanentId,
    cardName,
    reason,
    timeout: null,
  };
  
  // Set a timeout (60 seconds)
  const TIMEOUT_MS = 60000;
  pending.timeout = setTimeout(() => {
    // If no selection received, cancel
    const p = pendingSelections.get(confirmId);
    if (p) {
      pendingSelections.delete(confirmId);
      console.warn(`[creatureType] Selection timed out for ${cardName} (${confirmId})`);
      // Emit cancellation
      io.to(gameId).emit("creatureTypeSelectionCancelled", {
        confirmId,
        gameId,
        permanentId,
        reason: "timeout",
      });
    }
  }, TIMEOUT_MS);
  
  pendingSelections.set(confirmId, pending);
  
  // Emit request to the specific player's sockets
  for (const s of io.sockets.sockets.values()) {
    if (s.data?.playerId === playerId && !s.data?.spectator) {
      s.emit("creatureTypeSelectionRequest", {
        confirmId,
        gameId,
        permanentId,
        cardName,
        reason,
      });
    }
  }
  
  console.log(`[creatureType] Requested selection for ${cardName} (${confirmId}) from player ${playerId}`);
  return confirmId;
}

/**
 * Check if a card requires creature type selection on ETB
 */
export function requiresCreatureTypeSelection(card: any): { required: boolean; reason: string } {
  if (!card) return { required: false, reason: "" };
  
  const name = (card.name || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Morophon, the Boundless - "As Morophon enters the battlefield, choose a creature type"
  if (name.includes("morophon")) {
    return { required: true, reason: "Choose a creature type for Morophon's cost reduction" };
  }
  
  // Kindred Discovery - "As Kindred Discovery enters the battlefield, choose a creature type"
  if (name.includes("kindred discovery")) {
    return { required: true, reason: "Choose a creature type to draw cards when entering or attacking" };
  }
  
  // Cavern of Souls - "As Cavern of Souls enters the battlefield, choose a creature type"
  if (name.includes("cavern of souls")) {
    return { required: true, reason: "Choose a creature type for uncounterable casting" };
  }
  
  // Pillar of Origins - similar to Cavern
  if (name.includes("pillar of origins")) {
    return { required: true, reason: "Choose a creature type for mana ability" };
  }
  
  // Unclaimed Territory - "As Unclaimed Territory enters the battlefield, choose a creature type"
  if (name.includes("unclaimed territory")) {
    return { required: true, reason: "Choose a creature type for mana ability" };
  }
  
  // Urza's Incubator - "As Urza's Incubator enters the battlefield, choose a creature type"
  // Reduces cost of creature spells of chosen type by {2}
  if (name.includes("urza's incubator")) {
    return { required: true, reason: "Choose a creature type for Urza's Incubator cost reduction" };
  }
  
  // Herald's Horn - "As Herald's Horn enters the battlefield, choose a creature type"
  // Reduces cost by {1} and gives card advantage
  if (name.includes("herald's horn")) {
    return { required: true, reason: "Choose a creature type for Herald's Horn" };
  }
  
  // Icon of Ancestry - "As Icon of Ancestry enters the battlefield, choose a creature type"
  // Gives +1/+1 to creatures of that type
  if (name.includes("icon of ancestry")) {
    return { required: true, reason: "Choose a creature type for Icon of Ancestry" };
  }
  
  // Metallic Mimic - "As Metallic Mimic enters the battlefield, choose a creature type"
  if (name.includes("metallic mimic")) {
    return { required: true, reason: "Choose a creature type for Metallic Mimic" };
  }
  
  // Door of Destinies - "As Door of Destinies enters the battlefield, choose a creature type"
  if (name.includes("door of destinies")) {
    return { required: true, reason: "Choose a creature type for Door of Destinies" };
  }
  
  // Coat of Arms (doesn't need selection - affects all creature types)
  
  // Vanquisher's Banner - "As Vanquisher's Banner enters the battlefield, choose a creature type"
  if (name.includes("vanquisher's banner")) {
    return { required: true, reason: "Choose a creature type for Vanquisher's Banner" };
  }
  
  // Adaptive Automaton - "As Adaptive Automaton enters the battlefield, choose a creature type"
  if (name.includes("adaptive automaton")) {
    return { required: true, reason: "Choose a creature type for Adaptive Automaton" };
  }
  
  // Kindred Charge - "Choose a creature type"
  if (name.includes("kindred charge")) {
    return { required: true, reason: "Choose a creature type for Kindred Charge" };
  }
  
  // Kindred Summons - "Choose a creature type"
  if (name.includes("kindred summons")) {
    return { required: true, reason: "Choose a creature type for Kindred Summons" };
  }
  
  // Three Tree City - "As Three Tree City enters, choose a creature type"
  if (name.includes("three tree city")) {
    return { required: true, reason: "Choose a creature type for Three Tree City's mana ability" };
  }
  
  // Generic detection: look for the exact phrase "as ~ enters the battlefield, choose a creature type"
  // Supports both old template "enters the battlefield" and new Bloomburrow template "enters"
  // This is more specific than the previous loose matching
  const entersBattlefieldChoosePattern = /as .+? enters(?: the battlefield)?,? choose a creature type/i;
  if (entersBattlefieldChoosePattern.test(oracleText)) {
    return { required: true, reason: "Choose a creature type" };
  }
  
  return { required: false, reason: "" };
}

export function registerCreatureTypeHandlers(io: Server, socket: Socket) {
  // Handle creature type selection response
  socket.on("creatureTypeSelected", ({
    gameId,
    confirmId,
    creatureType,
  }: {
    gameId: string;
    confirmId: string;
    creatureType: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId || socket.data.spectator) {
        socket.emit("error", {
          code: "CREATURE_TYPE_UNAUTHORIZED",
          message: "Only players can select creature types",
        });
        return;
      }
      
      const pending = pendingSelections.get(confirmId);
      if (!pending) {
        socket.emit("error", {
          code: "CREATURE_TYPE_NOT_FOUND",
          message: "Selection request not found or expired",
        });
        return;
      }
      
      if (pending.playerId !== playerId) {
        socket.emit("error", {
          code: "CREATURE_TYPE_WRONG_PLAYER",
          message: "This selection request is not for you",
        });
        return;
      }
      
      if (pending.gameId !== gameId) {
        socket.emit("error", {
          code: "CREATURE_TYPE_GAME_MISMATCH",
          message: "Game ID mismatch",
        });
        return;
      }
      
      // Clear timeout
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      
      // Get the game
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", {
          code: "CREATURE_TYPE_NO_GAME",
          message: "Game not found",
        });
        pendingSelections.delete(confirmId);
        return;
      }
      
      // Apply the selection to the permanent
      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) => p?.id === pending.permanentId);
      
      if (permanent) {
        // Store the chosen creature type on the permanent
        permanent.chosenCreatureType = creatureType;
        
        // For Morophon, also apply cost reduction
        const cardName = (permanent.card?.name || "").toLowerCase();
        if (cardName.includes("morophon")) {
          // Morophon reduces the cost of spells of the chosen type by {W}{U}{B}{R}{G}
          const morophonChosenType = (game.state.morophonChosenType || {}) as Record<string, string>;
          morophonChosenType[pending.permanentId] = creatureType;
          game.state.morophonChosenType = morophonChosenType;
        }
        
        console.log(`[creatureType] Player ${playerId} chose ${creatureType} for ${pending.cardName}`);
      }
      
      // Persist the event
      try {
        appendEvent(gameId, (game as any).seq ?? 0, "creatureTypeSelected", {
          playerId,
          permanentId: pending.permanentId,
          creatureType,
          cardName: pending.cardName,
        });
      } catch (e) {
        console.warn("appendEvent(creatureTypeSelected) failed:", e);
      }
      
      // Bump sequence
      if (typeof game.bumpSeq === "function") {
        game.bumpSeq();
      }
      
      // Notify all players
      io.to(gameId).emit("creatureTypeSelectionConfirmed", {
        confirmId,
        gameId,
        permanentId: pending.permanentId,
        playerId,
        creatureType,
        cardName: pending.cardName,
      });
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, playerId)} chose ${creatureType} for ${pending.cardName}.`,
        ts: Date.now(),
      });
      
      // Clean up
      pendingSelections.delete(confirmId);
      
      // Broadcast updated game state
      broadcastGame(io, game, gameId);
    } catch (err) {
      console.error("[creatureType] creatureTypeSelected handler failed:", err);
      socket.emit("error", {
        code: "CREATURE_TYPE_ERROR",
        message: String(err),
      });
    }
  });
  
  // Handle manual creature type selection request (for cards like Coat of Arms that might need re-selection)
  socket.on("requestCreatureTypeSelection", ({
    gameId,
    permanentId,
    reason,
  }: {
    gameId: string;
    permanentId: string;
    reason?: string;
  }) => {
    try {
      const playerId = socket.data.playerId as string | undefined;
      if (!playerId || socket.data.spectator) {
        socket.emit("error", {
          code: "CREATURE_TYPE_UNAUTHORIZED",
          message: "Only players can request creature type selection",
        });
        return;
      }
      
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", {
          code: "CREATURE_TYPE_NO_GAME",
          message: "Game not found",
        });
        return;
      }
      
      // Find the permanent
      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) => p?.id === permanentId);
      
      if (!permanent) {
        socket.emit("error", {
          code: "CREATURE_TYPE_NO_PERMANENT",
          message: "Permanent not found",
        });
        return;
      }
      
      // Only the controller can request selection
      if (permanent.controller !== playerId) {
        socket.emit("error", {
          code: "CREATURE_TYPE_NOT_CONTROLLER",
          message: "Only the controller can select creature type",
        });
        return;
      }
      
      const cardName = permanent.card?.name || "Unknown";
      const finalReason = reason || `Choose a creature type for ${cardName}`;
      
      requestCreatureTypeSelection(io, gameId, playerId, permanentId, cardName, finalReason);
    } catch (err) {
      console.error("[creatureType] requestCreatureTypeSelection handler failed:", err);
      socket.emit("error", {
        code: "CREATURE_TYPE_ERROR",
        message: String(err),
      });
    }
  });
}
