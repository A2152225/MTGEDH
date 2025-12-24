import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import type { PlayerID } from "../../../shared/src/types";

/**
 * Generic player selection system
 * 
 * A unified, scalable system for any effect that requires selecting a player.
 * Supports multiple effect types that execute after player selection:
 * - 'set_chosen_player': Set chosenPlayer property on permanent (Stuffy Doll)
 * - 'control_change': Transfer control to selected player (Vislor Turlough, Xantcha)
 * - 'target_player': Target player for spell/ability effect
 * - Custom handlers can be added easily
 */

/**
 * Effect types that execute after player selection
 */
export type PlayerSelectionEffectType = 
  | 'set_chosen_player'    // Set permanent.chosenPlayer property (Stuffy Doll)
  | 'control_change'       // Change permanent control (Vislor Turlough, Xantcha)
  | 'target_player'        // Target player for spell/ability
  | 'custom';              // Custom effect with handler function

/**
 * Effect data for different effect types
 */
export interface PlayerSelectionEffectData {
  type: PlayerSelectionEffectType;
  
  // Common fields
  permanentId?: string;
  spellId?: string;
  abilityId?: string;
  
  // Control change specific
  goadsOnChange?: boolean;
  mustAttackEachCombat?: boolean;
  cantAttackOwner?: boolean;
  drawCards?: number;
  
  // Custom effect handler
  customHandler?: (
    io: Server,
    gameId: string,
    choosingPlayerId: PlayerID,
    selectedPlayerId: PlayerID,
    effectData: PlayerSelectionEffectData
  ) => void;
}

/**
 * Pending player selection request
 */
interface PendingPlayerSelection {
  gameId: string;
  playerId: PlayerID;
  cardName: string;
  description: string;
  allowOpponentsOnly: boolean;
  isOptional: boolean; // If true, player can decline (minTargets = 0)
  effectData: PlayerSelectionEffectData;
  timeout: NodeJS.Timeout | null;
}

const pendingSelections: Map<string, PendingPlayerSelection> = new Map();

/**
 * Create a unique selection ID
 */
function createSelectionId(): string {
  return `psel_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Request player selection from a player
 * 
 * @param io - Socket.IO server
 * @param gameId - Game ID
 * @param playerId - Player who needs to make selection
 * @param cardName - Name of card requiring selection
 * @param description - Description of what they're choosing for
 * @param effectData - Data defining what happens after selection
 * @param allowOpponentsOnly - If true, can only select opponents
 * @param isOptional - If true, player can decline selection
 * @returns Selection ID
 */
export function requestPlayerSelection(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  cardName: string,
  description: string,
  effectData: PlayerSelectionEffectData,
  allowOpponentsOnly: boolean = false,
  isOptional: boolean = false
): string {
  // Check for duplicate requests for same permanent/spell
  for (const [existingId, pending] of pendingSelections.entries()) {
    const sameTarget = 
      (effectData.permanentId && pending.effectData.permanentId === effectData.permanentId) ||
      (effectData.spellId && pending.effectData.spellId === effectData.spellId);
    
    if (sameTarget && pending.gameId === gameId) {
      debug(2, `[playerSelection] Selection already pending for ${cardName} (${existingId})`);
      return existingId;
    }
  }
  
  const selectionId = createSelectionId();
  
  // Store pending selection
  const pending: PendingPlayerSelection = {
    gameId,
    playerId,
    cardName,
    description,
    allowOpponentsOnly,
    isOptional,
    effectData,
    timeout: null,
  };
  
  // Set timeout (60 seconds)
  const TIMEOUT_MS = 60000;
  pending.timeout = setTimeout(() => {
    const p = pendingSelections.get(selectionId);
    if (p) {
      pendingSelections.delete(selectionId);
      debugWarn(2, `[playerSelection] Selection timed out for ${cardName} (${selectionId})`);
      
      // Auto-select randomly (or decline if optional)
      if (isOptional) {
        handleDeclinedSelection(io, gameId, playerId, cardName, effectData);
      } else {
        autoSelectRandomPlayer(io, gameId, selectionId, playerId, cardName, effectData, allowOpponentsOnly);
      }
    }
  }, TIMEOUT_MS);
  
  pendingSelections.set(selectionId, pending);
  
  // Get available players
  const game = ensureGame(gameId);
  if (!game) {
    debugError(1, `[playerSelection] Game not found: ${gameId}`);
    return selectionId;
  }
  
  const players = game.state?.players || [];
  const validPlayers = allowOpponentsOnly
    ? players.filter((p: any) => p && p.id !== playerId && !p.hasLost)
    : players.filter((p: any) => p && !p.hasLost);
  
  // Emit request to player's sockets
  for (const s of io.sockets.sockets.values()) {
    if (s.data?.playerId === playerId && !s.data?.spectator) {
      s.emit("playerSelectionRequest", {
        selectionId,
        gameId,
        cardName,
        description,
        allowOpponentsOnly,
        isOptional,
        players: validPlayers.map((p: any) => ({
          id: p.id,
          name: p.name || p.id,
          life: game.state?.life?.[p.id] ?? 40,
          libraryCount: (game.state?.zones?.[p.id] as any)?.libraryCount ?? 0,
        })),
      });
    }
  }
  
  debug(2, `[playerSelection] Requested selection for ${cardName} (${selectionId}) from ${playerId}`);
  return selectionId;
}

/**
 * Auto-select a random player when timeout occurs
 */
function autoSelectRandomPlayer(
  io: Server,
  gameId: string,
  selectionId: string,
  choosingPlayerId: PlayerID,
  cardName: string,
  effectData: PlayerSelectionEffectData,
  allowOpponentsOnly: boolean
): void {
  const game = ensureGame(gameId);
  if (!game) return;
  
  const players = game.state?.players || [];
  const validPlayers = allowOpponentsOnly
    ? players.filter((p: any) => p && p.id !== choosingPlayerId && !p.hasLost)
    : players.filter((p: any) => p && !p.hasLost);
  
  if (validPlayers.length > 0) {
    const randomPlayer = validPlayers[Math.floor(Math.random() * validPlayers.length)];
    executePlayerSelectionEffect(io, gameId, choosingPlayerId, randomPlayer.id, cardName, effectData, true);
  }
}

/**
 * Handle declined optional selection
 */
function handleDeclinedSelection(
  io: Server,
  gameId: string,
  playerId: PlayerID,
  cardName: string,
  effectData: PlayerSelectionEffectData
): void {
  const game = ensureGame(gameId);
  if (!game) return;
  
  // For control change effects, keep permanent under original controller
  if (effectData.type === 'control_change') {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} chose not to give control of ${cardName}.`,
      ts: Date.now(),
    });
  } else {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, playerId)} declined to choose a player for ${cardName}.`,
      ts: Date.now(),
    });
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  
  broadcastGame(io, game, gameId);
}

/**
 * Execute the effect after player selection
 */
function executePlayerSelectionEffect(
  io: Server,
  gameId: string,
  choosingPlayerId: PlayerID,
  selectedPlayerId: PlayerID,
  cardName: string,
  effectData: PlayerSelectionEffectData,
  wasTimeout: boolean = false
): void {
  const game = ensureGame(gameId);
  if (!game) return;
  
  const battlefield = game.state?.battlefield || [];
  
  switch (effectData.type) {
    case 'set_chosen_player': {
      // Set chosenPlayer property on permanent (Stuffy Doll)
      if (effectData.permanentId) {
        const permanent = battlefield.find((p: any) => p && p.id === effectData.permanentId);
        if (permanent) {
          (permanent as any).chosenPlayer = selectedPlayerId;
          debug(2, `[playerSelection] Set chosenPlayer for ${cardName} to ${selectedPlayerId}`);
        }
      }
      break;
    }
    
    case 'control_change': {
      // Transfer control of permanent (Vislor Turlough, Xantcha)
      if (effectData.permanentId) {
        const permanent = battlefield.find((p: any) => p && p.id === effectData.permanentId);
        if (permanent) {
          permanent.controller = selectedPlayerId;
          
          // Apply goad if specified
          if (effectData.goadsOnChange) {
            const currentTurn = (game.state as any).turnNumber || (game.state as any).turn || 0;
            const goadedBy = (permanent as any).goadedBy || [];
            const goadedUntil = (permanent as any).goadedUntil || {};
            
            if (!goadedBy.includes(choosingPlayerId)) {
              (permanent as any).goadedBy = [...goadedBy, choosingPlayerId];
              (permanent as any).goadedUntil = {
                ...goadedUntil,
                [choosingPlayerId]: currentTurn + 2, // Goaded until their next turn
              };
            }
          }
          
          // Draw cards if specified (Humble Defector)
          if (effectData.drawCards && effectData.drawCards > 0) {
            const zones = game.state?.zones?.[selectedPlayerId];
            if ((zones as any)?.library && zones?.hand) {
              for (let i = 0; i < effectData.drawCards; i++) {
                const card = (zones as any).library.shift();
                if (card) (zones as any).hand.push(card);
              }
            }
          }
          
          debug(2, `[playerSelection] Transferred control of ${cardName} to ${selectedPlayerId}`);
        }
      }
      break;
    }
    
    case 'target_player': {
      // Store target player for spell/ability resolution
      // This would be handled by the resolution system
      debug(2, `[playerSelection] Selected target player ${selectedPlayerId} for ${cardName}`);
      break;
    }
    
    case 'custom': {
      // Execute custom handler
      if (effectData.customHandler) {
        effectData.customHandler(io, gameId, choosingPlayerId, selectedPlayerId, effectData);
      }
      break;
    }
  }
  
  // Broadcast chat message
  const selectedPlayerName = getPlayerName(game, selectedPlayerId);
  const choosingPlayerName = getPlayerName(game, choosingPlayerId);
  
  let message = '';
  if (effectData.type === 'control_change') {
    message = `${choosingPlayerName}'s ${cardName} ${wasTimeout ? 'randomly went' : 'went'} to ${selectedPlayerName}.`;
  } else {
    message = `${choosingPlayerName}'s ${cardName} ${wasTimeout ? 'randomly chose' : 'chose'} ${selectedPlayerName}.`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  // Persist event
  appendEvent(gameId, (game as any).seq ?? 0, "playerSelection", {
    choosingPlayerId,
    selectedPlayerId,
    cardName,
    effectType: effectData.type,
    permanentId: effectData.permanentId,
    wasTimeout,
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
  
  broadcastGame(io, game, gameId);
}

/**
 * Register socket handlers for player selection
 */
export function registerPlayerSelectionHandlers(io: Server, socket: Socket) {
  /**
   * Player confirms their selection
   */
  socket.on("confirmPlayerSelection", ({ 
    gameId, 
    selectionId,
    selectedPlayerId,
  }: { 
    gameId: string; 
    selectionId: string;
    selectedPlayerId?: string; // Optional if declining
  }) => {
    try {
      const pid = socket.data.playerId as PlayerID | undefined;
      if (!pid || socket.data.spectator) return;
      
      const pending = pendingSelections.get(selectionId);
      if (!pending) {
        socket.emit("error", { 
          code: "INVALID_SELECTION", 
          message: "Invalid or expired player selection" 
        });
        return;
      }
      
      if (pending.playerId !== pid || pending.gameId !== gameId) {
        socket.emit("error", { 
          code: "NOT_YOUR_SELECTION", 
          message: "This is not your selection" 
        });
        return;
      }
      
      const game = ensureGame(gameId);
      if (!game) {
        socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
        return;
      }
      
      // Handle decline (for optional selections)
      if (!selectedPlayerId && pending.isOptional) {
        if (pending.timeout) clearTimeout(pending.timeout);
        pendingSelections.delete(selectionId);
        handleDeclinedSelection(io, gameId, pid, pending.cardName, pending.effectData);
        return;
      }
      
      // Validate selected player
      if (!selectedPlayerId) {
        socket.emit("error", { 
          code: "NO_PLAYER_SELECTED", 
          message: "Must select a player" 
        });
        return;
      }
      
      const players = game.state?.players || [];
      const validPlayers = pending.allowOpponentsOnly
        ? players.filter((p: any) => p && p.id !== pid && !p.hasLost)
        : players.filter((p: any) => p && !p.hasLost);
      
      if (!validPlayers.find((p: any) => p.id === selectedPlayerId)) {
        socket.emit("error", { 
          code: "INVALID_PLAYER", 
          message: "Invalid player selection" 
        });
        return;
      }
      
      // Clear timeout and execute effect
      if (pending.timeout) clearTimeout(pending.timeout);
      pendingSelections.delete(selectionId);
      
      executePlayerSelectionEffect(
        io, 
        gameId, 
        pid, 
        selectedPlayerId, 
        pending.cardName, 
        pending.effectData, 
        false
      );
      
    } catch (err) {
      debugError(1, `[playerSelection] confirmPlayerSelection failed:`, err);
      socket.emit("error", { 
        code: "SELECTION_FAILED", 
        message: "Failed to confirm selection" 
      });
    }
  });
}

/**
 * Check if there are pending selections for a player
 */
export function hasPendingPlayerSelections(gameId: string, playerId: PlayerID): boolean {
  for (const pending of pendingSelections.values()) {
    if (pending.gameId === gameId && pending.playerId === playerId) {
      return true;
    }
  }
  return false;
}

/**
 * Detect if a card requires player selection on ETB
 * Returns effect data for the appropriate effect type
 */
export function detectETBPlayerSelection(card: any): {
  required: boolean;
  description: string;
  effectData: PlayerSelectionEffectData | null;
  allowOpponentsOnly: boolean;
  isOptional: boolean;
} {
  if (!card) return { required: false, description: "", effectData: null, allowOpponentsOnly: false, isOptional: false };
  
  const name = (card.name || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Stuffy Doll - "As Stuffy Doll enters, choose a player"
  if (name.includes("stuffy doll")) {
    return {
      required: true,
      description: "Choose a player for Stuffy Doll's damage trigger",
      effectData: { type: 'set_chosen_player' },
      allowOpponentsOnly: false,
      isOptional: false,
    };
  }
  
  // Xantcha - "As Xantcha enters, choose an opponent"
  if (name.includes("xantcha")) {
    return {
      required: true,
      description: "Choose an opponent to control Xantcha",
      effectData: { type: 'control_change', mustAttackEachCombat: true },
      allowOpponentsOnly: true,
      isOptional: false,
    };
  }
  
  // Vislor Turlough - "You may have an opponent gain control"
  if (name.includes("vislor turlough")) {
    return {
      required: true,
      description: "Choose an opponent to control Vislor Turlough (optional)",
      effectData: { type: 'control_change', goadsOnChange: true },
      allowOpponentsOnly: true,
      isOptional: true,
    };
  }
  
  // Generic: "as ~ enters, choose a player"
  const entersChoosePlayerPattern = /as (?:~|this (?:creature|permanent)) enters(?: the battlefield)?,?\s+choose (?:a player|an opponent)/i;
  if (entersChoosePlayerPattern.test(oracleText)) {
    const opponentsOnly = /choose an opponent/i.test(oracleText);
    const isOptional = /you may/i.test(oracleText);
    
    // Determine effect type based on oracle text
    let effectType: PlayerSelectionEffectType = 'set_chosen_player';
    const effectData: PlayerSelectionEffectData = { type: effectType };
    
    // Check if it's a control change effect
    if (oracleText.includes('under the control of') || oracleText.includes('gains control')) {
      effectData.type = 'control_change';
    }
    
    return {
      required: true,
      description: `Choose ${opponentsOnly ? 'an opponent' : 'a player'} for ${card.name}`,
      effectData,
      allowOpponentsOnly: opponentsOnly,
      isOptional,
    };
  }
  
  return { required: false, description: "", effectData: null, allowOpponentsOnly: false, isOptional: false };
}
