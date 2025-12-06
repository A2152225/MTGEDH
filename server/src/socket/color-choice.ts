import type { Server, Socket } from "socket.io";
import { ensureGame, broadcastGame, getPlayerName } from "./util";
import { appendEvent } from "../db";

/**
 * Color choice selection handlers
 * 
 * Used for cards that require choosing a color as they enter the battlefield or resolve:
 * - Caged Sun - "As Caged Sun enters the battlefield, choose a color"
 * - Chromatic Lantern variants
 * - Color-specific protection effects
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
      console.log(`[colorChoice] Choice already pending for ${cardName} (${existingConfirmId}), skipping duplicate request`);
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
      console.warn(`[colorChoice] Choice timed out for ${cardName} (${confirmId})`);
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
  
  console.log(`[colorChoice] Requested color choice for ${cardName} (${confirmId}) from player ${playerId}`);
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
  const entersChooseColorPattern = /as .+? enters(?: the battlefield)?,? (?:you may )?choose a color/i;
  if (entersChooseColorPattern.test(oracleText)) {
    return { required: true, reason: "Choose a color" };
  }
  
  // Check for "choose a color" in general (might be on cast or activation)
  if (oracleText.includes("choose a color") || oracleText.includes("choose a colour")) {
    // Only return true for ETB effects, not activated abilities
    if (oracleText.includes("enters") || oracleText.includes("as") || oracleText.includes("when")) {
      return { required: true, reason: "Choose a color" };
    }
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
    
    console.log(`[colorChoice] ${getPlayerName(game, playerId)} chose ${selectedColor} for ${pending.cardName}`);
    
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
          console.warn('appendEvent(colorChoice) failed:', e);
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
    
    console.log(`[colorChoice] ${playerId} cancelled color choice for ${pending.cardName}`);
  });
}

/**
 * Get the chosen color for a permanent
 */
export function getChosenColor(permanent: any): string | undefined {
  return (permanent as any)?.chosenColor;
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
