import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { extractCreatureTypes, CREATURE_TYPES } from "../../../shared/src/creatureTypes";
import { debug, debugWarn, debugError } from "../utils/debug.js";

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

/** Default creature type fallback for AI when no dominant type is found */
const DEFAULT_AI_CREATURE_TYPE = 'Shapeshifter';

/** Delay before AI makes creature type selection (allows state to settle) */
const AI_CREATURE_TYPE_SELECTION_DELAY_MS = 100;

/**
 * Determine the most common creature type in a player's deck/library.
 * Used for AI to make intelligent creature type choices.
 * 
 * Analyzes the player's library, hand, battlefield, and graveyard to find
 * the creature type that appears most frequently.
 */
export function getDominantCreatureType(game: any, playerId: string): string {
  const creatureTypeCounts: Record<string, number> = {};
  
  // Helper to count creature types from a card
  const countTypesFromCard = (card: any) => {
    if (!card?.type_line) return;
    const typeLine = card.type_line.toLowerCase();
    // Only count creature cards (not all cards)
    if (!typeLine.includes('creature')) return;
    
    const types = extractCreatureTypes(card.type_line, card.oracle_text);
    
    // Skip if it's a changeling (has ALL types, not useful for counting)
    // Changelings return all creature types from extractCreatureTypes
    const oracleText = (card.oracle_text || '').toLowerCase();
    const isChangeling = oracleText.includes('changeling') || 
                         typeLine.includes('changeling') ||
                         types.length >= CREATURE_TYPES.length;
    if (isChangeling) return;
    
    for (const type of types) {
      creatureTypeCounts[type] = (creatureTypeCounts[type] || 0) + 1;
    }
  };
  
  // Count from library
  const zones = game.state?.zones?.[playerId];
  if (zones?.library && Array.isArray(zones.library)) {
    for (const card of zones.library) {
      countTypesFromCard(card);
    }
  }
  
  // Count from hand
  if (zones?.hand && Array.isArray(zones.hand)) {
    for (const card of zones.hand) {
      countTypesFromCard(card);
    }
  }
  
  // Count from battlefield (weighted more since these are cards in play)
  const battlefield = game.state?.battlefield || [];
  for (const permanent of battlefield) {
    if (permanent.controller !== playerId) continue;
    countTypesFromCard(permanent.card);
  }
  
  // Count from graveyard
  if (zones?.graveyard && Array.isArray(zones.graveyard)) {
    for (const card of zones.graveyard) {
      countTypesFromCard(card);
    }
  }
  
  // Find the most common type
  let dominantType = DEFAULT_AI_CREATURE_TYPE;
  let maxCount = 0;
  
  for (const [type, count] of Object.entries(creatureTypeCounts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantType = type;
    }
  }
  
  debug(2, `[creatureType] AI dominant creature type analysis for ${playerId}:`, {
    topTypes: Object.entries(creatureTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => `${type}(${count})`),
    chosen: dominantType,
  });
  
  return dominantType;
}

/**
 * Check if a player is an AI player
 */
export function isAIPlayer(game: any, playerId: string): boolean {
  const players = game.state?.players || [];
  const player = players.find((p: any) => p?.id === playerId);
  return player?.isAI === true;
}

/**
 * Handle AI creature type selection automatically
 */
export function applyCreatureTypeSelection(
  io: Server | null,
  game: any,
  gameId: string,
  playerId: string,
  permanentId: string,
  cardName: string,
  chosenTypeValue: string,
  isAI: boolean
): void {
  const chosenType = chosenTypeValue;
  
  debug(2, `[creatureType] Applying creature type ${chosenType} for ${cardName} (player ${playerId})`);
  
  // Apply the selection to the permanent
  const battlefield = game.state?.battlefield || [];
  const permanent = battlefield.find((p: any) => p?.id === permanentId);
  
  if (permanent) {
    permanent.chosenCreatureType = chosenType;
    
    // For Morophon, also apply cost reduction tracking
    const permCardName = (permanent.card?.name || "").toLowerCase();
    if (permCardName.includes("morophon")) {
      const morophonChosenType = (game.state.morophonChosenType || {}) as Record<string, string>;
      morophonChosenType[permanentId] = chosenType;
      game.state.morophonChosenType = morophonChosenType;
    }
  }
  
  // Persist the event
  try {
    appendEvent(gameId, (game as any).seq ?? 0, "creatureTypeSelected", {
      playerId,
      permanentId,
      creatureType: chosenType,
      cardName,
      isAI,
    });
  } catch (e) {
    debugWarn(1, "appendEvent(creatureTypeSelected) failed:", e);
  }
  
  // Bump sequence
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  
  if (io) {
    io.to(gameId).emit("creatureTypeSelectionConfirmed", {
      confirmId: null,
      gameId,
      permanentId,
      playerId,
      creatureType: chosenType,
      cardName,
      isAI,
    });
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)}${isAI ? " (AI)" : ""} chose ${chosenType} for ${cardName}.`,
      ts: Date.now(),
    });
    
    broadcastGame(io, game, gameId);
  }
}

export function handleAICreatureTypeSelection(
  io: Server,
  game: any,
  gameId: string,
  playerId: string,
  permanentId: string,
  cardName: string,
  confirmId: string
): void {
  const chosenType = getDominantCreatureType(game, playerId);
  debug(2, `[creatureType] AI ${playerId} automatically choosing ${chosenType} for ${cardName}`);
  applyCreatureTypeSelection(io, game, gameId, playerId, permanentId, cardName, chosenType, true);
}

/**
 * Request a creature type selection from a player.
 * For AI players, automatically selects the dominant creature type in their deck.
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
      debug(2, `[creatureType] Selection already pending for ${cardName} (${existingConfirmId}), skipping duplicate request`);
      return existingConfirmId;
    }
  }
  
  const confirmId = createConfirmId();
  
  // Check if this is an AI player - handle automatically
  const game = ensureGame(gameId);
  if (game && isAIPlayer(game, playerId)) {
    debug(2, `[creatureType] Player ${playerId} is AI, handling selection automatically`);
    // Use setTimeout to avoid blocking and allow state to settle after permanent enters battlefield
    setTimeout(() => {
      handleAICreatureTypeSelection(io, game, gameId, playerId, permanentId, cardName, confirmId);
    }, AI_CREATURE_TYPE_SELECTION_DELAY_MS);
    return confirmId;
  }
  
  // Store pending selection for human players
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
      debugWarn(2, `[creatureType] Selection timed out for ${cardName} (${confirmId})`);
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
  
  debug(2, `[creatureType] Requested selection for ${cardName} (${confirmId}) from player ${playerId}`);
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
        
        debug(2, `[creatureType] Player ${playerId} chose ${creatureType} for ${pending.cardName}`);
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
        debugWarn(1, "appendEvent(creatureTypeSelected) failed:", e);
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
      debugError(1, "[creatureType] creatureTypeSelected handler failed:", err);
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
      debugError(1, "[creatureType] requestCreatureTypeSelection handler failed:", err);
      socket.emit("error", {
        code: "CREATURE_TYPE_ERROR",
        message: String(err),
      });
    }
  });
}

/**
 * Check if there are any pending creature type selections for a game
 */
export function hasPendingCreatureTypeSelections(gameId: string): boolean {
  for (const pending of pendingSelections.values()) {
    if (pending.gameId === gameId) {
      return true;
    }
  }
  return false;
}
