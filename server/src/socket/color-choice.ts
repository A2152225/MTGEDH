import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { ResolutionQueueManager, ResolutionStepStatus } from "../state/resolution/index.js";
import { ResolutionStepType } from "../state/resolution/types.js";

/**
 * Color choice selection handlers
 * 
 * Used for cards that require choosing a color as they enter the battlefield or resolve:
 * - Caged Sun - "As Caged Sun enters the battlefield, choose a color"
 * - Chromatic Lantern variants
 * - Color-specific protection effects
 * - Brave the Elements - "Choose a color. White creatures you control gain protection..."
 * etc.
 */

/**
 * Pending color choice selection requests
 * Key: confirmId
 */
interface PendingColorChoice {
  gameId: string;
  playerId: string;
  permanentId?: string; // For permanents entering battlefield
  spellId?: string; // For spells resolving
  cardName: string;
  reason: string;
  timeout: NodeJS.Timeout | null;
}

const pendingChoices: Map<string, PendingColorChoice> = new Map();

/**
 * Create a unique confirmation ID
 */
function createConfirmId(): string {
  return `color_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Request a color choice from a player
 */
export function requestColorChoice(
  io: Server,
  gameId: string,
  playerId: string,
  cardName: string,
  reason: string,
  permanentId?: string,
  spellId?: string
): string {
  // Check if there's already a pending choice for this card
  for (const [existingConfirmId, pending] of pendingChoices.entries()) {
    // Match if both are for the same permanent or both are for the same spell
    const matchesPermanent = permanentId && pending.permanentId === permanentId;
    const matchesSpell = spellId && pending.spellId === spellId;
    
    if ((matchesPermanent || matchesSpell) && pending.gameId === gameId) {
      debug(2, `[colorChoice] Choice already pending for ${cardName} (${existingConfirmId}), skipping duplicate request`);
      return existingConfirmId;
    }
  }
  
  const confirmId = createConfirmId();
  
  // Store pending choice
  const pending: PendingColorChoice = {
    gameId,
    playerId,
    permanentId,
    spellId,
    cardName,
    reason,
    timeout: null,
  };
  
  // Set a timeout (60 seconds)
  const TIMEOUT_MS = 60000;
  pending.timeout = setTimeout(() => {
    // If no choice received, cancel
    const p = pendingChoices.get(confirmId);
    if (p) {
      pendingChoices.delete(confirmId);
      debugWarn(2, `[colorChoice] Choice timed out for ${cardName} (${confirmId})`);
      // Emit cancellation
      io.to(gameId).emit("colorChoiceCancelled", {
        confirmId,
        gameId,
        permanentId,
        spellId,
        reason: "timeout",
      });
    }
  }, TIMEOUT_MS);
  
  pendingChoices.set(confirmId, pending);
  
  // Emit request to the specific player's sockets
  for (const s of io.sockets.sockets.values()) {
    if (s.data?.playerId === playerId && !s.data?.spectator) {
      s.emit("colorChoiceRequest", {
        confirmId,
        gameId,
        permanentId,
        spellId,
        cardName,
        reason,
        colors: ['white', 'blue', 'black', 'red', 'green'], // Available color choices
      });
    }
  }
  
  debug(2, `[colorChoice] Requested color choice for ${cardName} (${confirmId}) from player ${playerId}`);
  return confirmId;
}

/**
 * Check if a card requires color choice on ETB
 */
export function requiresColorChoice(card: any): { required: boolean; reason: string } {
  if (!card) return { required: false, reason: "" };
  
  const name = (card.name || "").toLowerCase();
  const oracleText = (card.oracle_text || "").toLowerCase();
  
  // Caged Sun - "As Caged Sun enters the battlefield, choose a color"
  if (name.includes("caged sun")) {
    return { required: true, reason: "Choose a color for Caged Sun's effects" };
  }
  
  // Gauntlet of Power - "As Gauntlet of Power enters the battlefield, choose a color"
  if (name.includes("gauntlet of power")) {
    return { required: true, reason: "Choose a color for Gauntlet of Power" };
  }
  
  // Extraplanar Lens - "As Extraplanar Lens enters the battlefield, you may choose a color"
  if (name.includes("extraplanar lens")) {
    return { required: true, reason: "Choose a color for Extraplanar Lens (optional)" };
  }
  
  // Generic detection: look for "as ~ enters the battlefield, choose a color" or "as ~ enters, choose a color"
  // This pattern specifically matches the ETB template where choosing a color is part of the enters clause
  // Pattern breakdown:
  // - "as .+? enters" matches "as [card name] enters" 
  // - "(?: the battlefield)?" optionally matches " the battlefield" (newer template omits this)
  // - ",?\s+" matches optional comma and whitespace
  // - "(?:you may\s+)?" optionally matches "you may "
  // - "choose a colou?r" matches "choose a color" or "choose a colour"
  // - "\.?" optionally matches period at end
  // - Must be followed by sentence boundary (end of string, newline, or next sentence)
  const entersChooseColorPattern = /as .+? enters(?: the battlefield)?,?\s+(?:you may\s+)?choose a colou?r\.?(?:\n|$)/i;
  if (entersChooseColorPattern.test(oracleText)) {
    return { required: true, reason: "Choose a color" };
  }
  
  return { required: false, reason: "" };
}

/**
 * Register socket handlers for color choice
 */
export function registerColorChoiceHandlers(io: Server, socket: Socket) {
  /**
   * Handle color choice submission
   */
  socket.on("submitColorChoice", ({ gameId, confirmId, selectedColor }: {
    gameId: string;
    confirmId: string;
    selectedColor: 'white' | 'blue' | 'black' | 'red' | 'green';
  }) => {
    const playerId = socket.data.playerId;
    if (!playerId || socket.data.spectator) return;
    
    // First, check if this is a Resolution Queue step
    const queue = ResolutionQueueManager.getQueue(gameId);
    const resolutionStep = queue.steps.find(
      s => s.id === confirmId && s.type === ResolutionStepType.COLOR_CHOICE
    );
    
    if (resolutionStep) {
      // Handle via Resolution Queue system
      debug(2, `[colorChoice] Handling via Resolution Queue for ${confirmId}`);
      
      // Verify this is the correct player
      if (resolutionStep.playerId !== playerId) {
        socket.emit("error", {
          code: "WRONG_PLAYER",
          message: "This choice is not for you",
        });
        return;
      }
      
      // Complete the resolution step
      const response = {
        stepId: confirmId,
        playerId,
        selections: [selectedColor],
        cancelled: false,
        timestamp: Date.now(),
      };
      
      // Process the step completion through ResolutionQueueManager
      ResolutionQueueManager.completeStep(gameId, confirmId, response);
      
      // Get game and apply the color choice
      const game = ensureGame(gameId);
      if (game) {
        const state = game.state as any || {};
        const cardName = resolutionStep.sourceName || 'Card';
        const permanentId = (resolutionStep as any).permanentId || resolutionStep.sourceId;
        const spellId = (resolutionStep as any).spellId;
        
        // Apply color choice to the appropriate object
        if (spellId) {
          // Spell on stack - store color choice for when it resolves
          const stack = state.stack || [];
          const spell = stack.find((s: any) => s.id === spellId || s.cardId === spellId);
          if (spell) {
            (spell as any).chosenColor = selectedColor;
            debug(2, `[colorChoice] Set chosenColor=${selectedColor} on spell ${spellId}`);
          }
        } else if (permanentId) {
          // Permanent on battlefield
          const battlefield = state.battlefield || [];
          const permanent = battlefield.find((p: any) => p?.id === permanentId);
          if (permanent) {
            (permanent as any).chosenColor = selectedColor;
            debug(2, `[colorChoice] Set chosenColor=${selectedColor} on permanent ${permanentId}`);
          }
        }
        
        // Emit confirmation
        io.to(gameId).emit("colorChoiceConfirmed", {
          gameId,
          confirmId,
          permanentId,
          spellId,
          cardName,
          selectedColor,
          playerId,
        });
        
        // Broadcast chat message
        io.to(gameId).emit("chat", {
          id: `cc_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} chose ${selectedColor} for ${cardName}.`,
          ts: Date.now(),
        });
        
        // Persist event
        try {
          appendEvent(gameId, (game as any).seq ?? 0, "colorChoice", {
            playerId,
            permanentId,
            spellId,
            cardName,
            selectedColor,
          });
        } catch (e) {
          debugWarn(1, 'appendEvent(colorChoice) failed:', e);
        }
        
        // Bump sequence
        if (typeof (game as any).bumpSeq === "function") {
          (game as any).bumpSeq();
        }
        
        // Broadcast updated game state
        broadcastGame(io, game, gameId);
      }
      
      return;
    }
    
    // Fall back to legacy pending choices system
    const pending = pendingChoices.get(confirmId);
    if (!pending) {
      socket.emit("error", {
        code: "CHOICE_NOT_FOUND",
        message: "Color choice request not found or already completed",
      });
      return;
    }
    
    // Verify this is the correct player
    if (pending.playerId !== playerId) {
      socket.emit("error", {
        code: "WRONG_PLAYER",
        message: "This choice is not for you",
      });
      return;
    }
    
    // Clear timeout
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    
    // Remove from pending
    pendingChoices.delete(confirmId);
    
    // Get game
    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", {
        code: "GAME_NOT_FOUND",
        message: "Game not found",
      });
      return;
    }
    
    debug(2, `[colorChoice] ${getPlayerName(game, playerId)} chose ${selectedColor} for ${pending.cardName}`);
    
    // Apply the color choice to the permanent or spell
    if (pending.permanentId) {
      const battlefield = game.state?.battlefield || [];
      const permanent = battlefield.find((p: any) => p?.id === pending.permanentId);
      
      if (permanent) {
        // Store chosen color on the permanent
        (permanent as any).chosenColor = selectedColor;
        
        // Emit confirmation
        io.to(gameId).emit("colorChoiceConfirmed", {
          gameId,
          confirmId,
          permanentId: pending.permanentId,
          cardName: pending.cardName,
          selectedColor,
          playerId,
        });
        
        // Broadcast chat message
        io.to(gameId).emit("chat", {
          id: `cc_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} chose ${selectedColor} for ${pending.cardName}.`,
          ts: Date.now(),
        });
        
        // Persist event
        try {
          appendEvent(gameId, (game as any).seq ?? 0, "colorChoice", {
            playerId,
            permanentId: pending.permanentId,
            cardName: pending.cardName,
            selectedColor,
          });
        } catch (e) {
          debugWarn(1, 'appendEvent(colorChoice) failed:', e);
        }
      }
    } else if (pending.spellId) {
      // Handle spell color choice (if needed in future)
      // Store on the spell on stack
      const stack = game.state?.stack || [];
      const spell = stack.find((s: any) => s?.id === pending.spellId);
      
      if (spell) {
        (spell as any).chosenColor = selectedColor;
      }
      
      io.to(gameId).emit("colorChoiceConfirmed", {
        gameId,
        confirmId,
        spellId: pending.spellId,
        cardName: pending.cardName,
        selectedColor,
        playerId,
      });
    }
    
    // Broadcast updated game state
    broadcastGame(io, game, gameId);
  });
  
  /**
   * Handle color choice cancellation
   */
  socket.on("cancelColorChoice", ({ gameId, confirmId }: {
    gameId: string;
    confirmId: string;
  }) => {
    const playerId = socket.data.playerId;
    if (!playerId) return;
    
    const pending = pendingChoices.get(confirmId);
    if (!pending || pending.playerId !== playerId) return;
    
    if (pending.timeout) {
      clearTimeout(pending.timeout);
    }
    
    pendingChoices.delete(confirmId);
    
    io.to(gameId).emit("colorChoiceCancelled", {
      confirmId,
      gameId,
      reason: "player_cancelled",
    });
    
    debug(2, `[colorChoice] ${playerId} cancelled color choice for ${pending.cardName}`);
  });
}

/**
 * Get the chosen color for a permanent
 */
export function getChosenColor(permanent: any): string | undefined {
  return (permanent as any)?.chosenColor;
}

/**
 * Check if there are any pending color choices for a game
 */
export function hasPendingColorChoices(gameId: string): boolean {
  for (const pending of pendingChoices.values()) {
    if (pending.gameId === gameId) {
      return true;
    }
  }
  return false;
}

/**
 * Clear all pending choices for a game (e.g., when game ends)
 */
export function clearPendingChoicesForGame(gameId: string) {
  for (const [confirmId, pending] of pendingChoices.entries()) {
    if (pending.gameId === gameId) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pendingChoices.delete(confirmId);
    }
  }
}

