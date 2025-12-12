/**
 * automation.ts
 * 
 * Socket.IO handlers for MTG Online-style gameplay automation.
 * Handles decision submissions, combat declarations, and automation control.
 */

import type { Server, Socket } from "socket.io";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData,
} from "../../../shared/src/events.js";
import { games } from "./socket.js";
import GameManager from "../GameManager.js";
import { canRespond, canAct } from "../state/modules/can-respond.js";

/**
 * Register automation-related socket handlers
 */
export function registerAutomationHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  socket: Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
) {
  /**
   * Handle decision submission (targets, modes, X values, etc.)
   */
  socket.on("submitDecision", async (payload) => {
    const { gameId, decisionId, selection } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    const game = games.get(gameId);
    if (!game) {
      socket.emit("error", { message: "Game not found" });
      return;
    }
    
    console.log(`[Automation] Decision submitted: ${decisionId} by ${playerId}`);
    
    try {
      // Process the decision
      const result = await processDecision(gameId, playerId, decisionId, selection);
      
      if (!result.success) {
        socket.emit("error", { message: result.error || "Failed to process decision" });
        return;
      }
      
      // Notify all players of the decision result
      io.to(gameId).emit("decisionResolved", {
        gameId,
        decisionId,
        playerId,
        selection,
      });
      
      // Continue automation and check for new decisions
      const automationResult = await runAutomationStep(gameId, io);
      
      // Broadcast updated state
      if (automationResult.stateChanged) {
        io.to(gameId).emit("state", { view: automationResult.state });
      }
      
      // Broadcast automation status
      io.to(gameId).emit("automationStatus", {
        gameId,
        status: automationResult.status as 'running' | 'waiting_for_decision' | 'waiting_for_priority' | 'paused' | 'completed',
        priorityPlayer: automationResult.priorityPlayer,
        pendingDecisionCount: automationResult.pendingDecisions.length,
      });
      
      // Send pending decisions to respective players
      for (const decision of automationResult.pendingDecisions) {
        const targetSocket = findPlayerSocket(io, gameId, decision.playerId);
        if (targetSocket) {
          targetSocket.emit("pendingDecision", { gameId, decision });
        }
      }
    } catch (err) {
      console.error("[Automation] Error processing decision:", err);
      socket.emit("error", { message: "Failed to process decision" });
    }
  });

  // NOTE: declareAttackers and declareBlockers handlers are implemented in combat.ts
  // Do not duplicate them here to avoid state corruption from multiple handlers firing.

  /**
   * Handle spell casting with targets/modes
   */
  socket.on("castSpell", async (payload) => {
    const { gameId, cardId, targets, modes, xValue, manaPayment } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    const game = games.get(gameId);
    if (!game) {
      socket.emit("error", { message: "Game not found" });
      return;
    }
    
    console.log(`[Automation] Spell cast by ${playerId}: ${cardId}`);
    
    try {
      const result = await processCastSpell(gameId, playerId, {
        cardId,
        targets,
        modes,
        xValue,
        manaPayment,
      });
      
      if (!result.success) {
        socket.emit("error", { message: result.error || "Failed to cast spell" });
        return;
      }
      
      // Broadcast stack update
      io.to(gameId).emit("stackUpdate", {
        gameId,
        stack: result.stack || [],
      });
      
      // Broadcast game action
      io.to(gameId).emit("gameAction", {
        gameId,
        action: "castSpell",
        playerId,
        details: { cardId, targets, modes, xValue },
        timestamp: Date.now(),
      });
      
      // Continue automation
      const automationResult = await runAutomationStep(gameId, io);
      if (automationResult.stateChanged) {
        io.to(gameId).emit("state", { view: automationResult.state });
      }
    } catch (err) {
      console.error("[Automation] Error casting spell:", err);
      socket.emit("error", { message: "Failed to cast spell" });
    }
  });

  /**
   * Handle ability activation
   */
  socket.on("activateAbility", async (payload) => {
    const { gameId, permanentId, abilityIndex, targets, manaPayment } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    const game = games.get(gameId);
    if (!game) {
      socket.emit("error", { message: "Game not found" });
      return;
    }
    
    console.log(`[Automation] Ability activated by ${playerId}: ${permanentId} ability ${abilityIndex}`);
    
    try {
      const result = await processActivateAbility(gameId, playerId, {
        permanentId,
        abilityIndex,
        targets,
        manaPayment,
      });
      
      if (!result.success) {
        socket.emit("error", { message: result.error || "Failed to activate ability" });
        return;
      }
      
      // Broadcast stack update if ability uses stack
      if (result.usesStack) {
        io.to(gameId).emit("stackUpdate", {
          gameId,
          stack: result.stack || [],
        });
      }
      
      // Broadcast game action
      io.to(gameId).emit("gameAction", {
        gameId,
        action: "activateAbility",
        playerId,
        details: { permanentId, abilityIndex, targets },
        timestamp: Date.now(),
      });
      
      // Continue automation
      const automationResult = await runAutomationStep(gameId, io);
      if (automationResult.stateChanged) {
        io.to(gameId).emit("state", { view: automationResult.state });
      }
    } catch (err) {
      console.error("[Automation] Error activating ability:", err);
      socket.emit("error", { message: "Failed to activate ability" });
    }
  });

  /**
   * Handle mulligan decision
   */
  socket.on("mulliganDecision", async (payload) => {
    const { gameId, keep } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    console.log(`[Automation] Mulligan decision by ${playerId}: ${keep ? "keep" : "mulligan"}`);
    
    try {
      const result = await processMulliganDecision(gameId, playerId, keep);
      
      if (!result.success) {
        socket.emit("error", { message: result.error || "Failed to process mulligan" });
        return;
      }
      
      // Broadcast game action
      io.to(gameId).emit("gameAction", {
        gameId,
        action: keep ? "keepHand" : "mulligan",
        playerId,
        timestamp: Date.now(),
      });
      
      // Continue automation
      const automationResult = await runAutomationStep(gameId, io);
      if (automationResult.stateChanged) {
        io.to(gameId).emit("state", { view: automationResult.state });
      }
    } catch (err) {
      console.error("[Automation] Error processing mulligan:", err);
      socket.emit("error", { message: "Failed to process mulligan" });
    }
  });

  /**
   * Handle mulligan bottom cards selection
   */
  socket.on("mulliganBottomCards", async (payload) => {
    const { gameId, cardIds } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    console.log(`[Automation] Mulligan bottom cards by ${playerId}: ${cardIds.length} cards`);
    
    try {
      const result = await processMulliganBottom(gameId, playerId, cardIds);
      
      if (!result.success) {
        socket.emit("error", { message: result.error || "Failed to put cards on bottom" });
        return;
      }
      
      // Continue automation
      const automationResult = await runAutomationStep(gameId, io);
      if (automationResult.stateChanged) {
        io.to(gameId).emit("state", { view: automationResult.state });
      }
    } catch (err) {
      console.error("[Automation] Error processing mulligan bottom:", err);
      socket.emit("error", { message: "Failed to put cards on bottom" });
    }
  });

  /**
   * Handle auto-pass toggle
   */
  socket.on("setAutoPass", (payload) => {
    const { gameId, enabled } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    console.log(`[Automation] Auto-pass ${enabled ? "enabled" : "disabled"} for ${playerId} in game ${gameId}`);
    
    // Store auto-pass preference (would be in game state or automation config)
    const game = games.get(gameId);
    if (game && game.state) {
      const autoPassPlayers = (game.state as any).autoPassPlayers || new Set();
      const wasEnabled = autoPassPlayers.has(playerId);
      
      if (enabled) {
        autoPassPlayers.add(playerId);
        
        // Only clear justSkippedToPhase if the player is RE-ENABLING auto-pass
        // (i.e., it wasn't already enabled). This allows phase navigator to work
        // even when auto-pass is enabled - the flag persists until they actively
        // toggle auto-pass back on after using the navigator.
        if (!wasEnabled) {
          const justSkipped = (game.state as any).justSkippedToPhase;
          if (justSkipped && justSkipped.playerId === playerId) {
            delete (game.state as any).justSkippedToPhase;
            console.log(`[Automation] Cleared justSkippedToPhase for ${playerId} (re-enabled auto-pass)`);
          }
        }
      } else {
        autoPassPlayers.delete(playerId);
      }
      (game.state as any).autoPassPlayers = autoPassPlayers;
      
      // Log the current state
      console.log(`[Automation] Auto-pass players in game ${gameId}:`, Array.from(autoPassPlayers));
      
      // Confirm the change back to the client
      socket.emit("autoPassToggled", { 
        gameId, 
        playerId,
        enabled,
        success: true 
      });
      
      // Bump sequence to trigger state update
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      
      // CRITICAL FIX: If player enabled auto-pass and has priority, immediately check for auto-pass
      // This fixes the bug where enabling auto-pass didn't immediately pass priority
      if (enabled && (game.state as any).priority === playerId) {
        console.log(`[Automation] Player ${playerId} has priority - triggering auto-pass check`);
        
        // Import broadcastGame dynamically to avoid circular dependency
        const utilModule = require('./util.js');
        if (utilModule && utilModule.broadcastGame) {
          // Broadcast game state which will trigger checkAndTriggerAutoPass
          utilModule.broadcastGame(io, game, gameId);
        }
      }
    } else {
      console.warn(`[Automation] Failed to toggle auto-pass: game ${gameId} not found or has no state`);
      socket.emit("error", { message: "Game not found" });
    }
  });

  /**
   * Handle auto-pass for rest of turn toggle
   */
  socket.on("setAutoPassForTurn", (payload) => {
    const { gameId, enabled } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    console.log(`[Automation] Auto-pass for turn ${enabled ? "enabled" : "disabled"} for ${playerId} in game ${gameId}`);
    
    const game = games.get(gameId);
    if (game && game.state) {
      const stateAny = game.state as any;
      if (!stateAny.autoPassForTurn) {
        stateAny.autoPassForTurn = {};
      }
      
      if (enabled) {
        stateAny.autoPassForTurn[playerId] = true;
        
        // When enabling auto-pass for turn, clear the justSkippedToPhase flag for this player
        // This allows auto-pass to work normally after they've navigated with phase navigator
        const justSkipped = stateAny.justSkippedToPhase;
        if (justSkipped && justSkipped.playerId === playerId) {
          delete stateAny.justSkippedToPhase;
          console.log(`[Automation] Cleared justSkippedToPhase for ${playerId} (enabled auto-pass for turn)`);
        }
      } else {
        delete stateAny.autoPassForTurn[playerId];
      }
      
      console.log(`[Automation] Auto-pass for turn state in game ${gameId}:`, stateAny.autoPassForTurn);
      
      // Bump sequence to trigger state update
      if (typeof (game as any).bumpSeq === 'function') {
        (game as any).bumpSeq();
      }
      
      // CRITICAL FIX: If player enabled auto-pass and has priority, immediately pass it
      // This fixes the bug where toggling "Auto-Pass Rest of Turn" didn't pass priority
      if (enabled && stateAny.priority === playerId) {
        console.log(`[Automation] Player ${playerId} has priority - immediately auto-passing`);
        
        // Import broadcastGame dynamically to avoid circular dependency
        const utilModule = require('./util.js');
        if (utilModule && utilModule.broadcastGame) {
          // Broadcast game state which will trigger checkAndTriggerAutoPass
          utilModule.broadcastGame(io, game, gameId);
        }
      }
    } else {
      console.warn(`[Automation] Failed to toggle auto-pass for turn: game ${gameId} not found or has no state`);
      socket.emit("error", { message: "Game not found" });
    }
  });

  /**
   * Handle claim priority (player wants to retain priority and take action)
   * This prevents auto-pass from immediately passing their priority
   */
  socket.on("claimPriority", (payload) => {
    const { gameId } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    const game = games.get(gameId);
    if (!game || !game.state) {
      socket.emit("error", { message: "Game not found" });
      return;
    }
    
    console.log(`[Automation] Player ${playerId} claimed priority in game ${gameId}`);
    
    // Mark that this player has claimed priority for this step
    // This will prevent auto-pass from passing them immediately
    const stateAny = game.state as any;
    if (!stateAny.priorityClaimed) {
      stateAny.priorityClaimed = new Set<string>();
    }
    stateAny.priorityClaimed.add(playerId);
    
    // The claim is cleared when the step advances in nextStep logic
  });

  /**
   * Check if a player can respond or act (query from client)
   * Returns whether the player has any available responses or actions
   */
  socket.on("checkCanRespond", ({ gameId }: { gameId: string }) => {
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("canRespondResponse", { canRespond: false, canAct: false, reason: "Not in game" });
      return;
    }
    
    const game = games.get(gameId);
    if (!game || !game.state) {
      socket.emit("canRespondResponse", { canRespond: false, canAct: false, reason: "Game not found" });
      return;
    }
    
    try {
      // Create a minimal context for the check
      const ctx = {
        state: game.state,
        inactive: new Set(),
        passesInRow: { value: 0 },
        bumpSeq: () => {},
      };
      
      const playerCanRespond = canRespond(ctx as any, playerId);
      const playerCanAct = canAct(ctx as any, playerId);
      
      socket.emit("canRespondResponse", {
        canRespond: playerCanRespond,
        canAct: playerCanAct,
      });
      
      console.log(`[Automation] Player ${playerId} can respond: ${playerCanRespond}`);
    } catch (err) {
      console.error("[Automation] Error in checkCanRespond:", err);
      socket.emit("canRespondResponse", { 
        canRespond: true, // Default to true on error to be safe
        canAct: true,
        reason: "Failed to check response capability" 
      });
    }
  });

  /**
   * Handle phase stop toggle
   */
  socket.on("setStop", (payload) => {
    const { gameId, phase, enabled } = payload;
    const playerId = socket.data.playerId;
    
    if (!playerId) {
      socket.emit("error", { message: "Not in a game" });
      return;
    }
    
    console.log(`[Automation] Stop at ${phase} ${enabled ? "enabled" : "disabled"} for ${playerId}`);
    
    // Store stop preference
    const game = games.get(gameId);
    if (game && game.state) {
      const playerStops = (game.state as any).playerStops || {};
      if (!playerStops[playerId]) {
        playerStops[playerId] = {};
      }
      playerStops[playerId][phase] = enabled;
      (game.state as any).playerStops = playerStops;
    }
  });
}

// ===== Helper Functions =====

/**
 * Find a player's socket in a game room
 */
function findPlayerSocket(
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>,
  gameId: string,
  playerId: string
): Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData> | null {
  const room = io.sockets.adapter.rooms.get(gameId);
  if (!room) return null;
  
  for (const socketId of room) {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.data.playerId === playerId) {
      return socket;
    }
  }
  
  return null;
}

/**
 * Process a decision response
 */
async function processDecision(
  gameId: string,
  playerId: string,
  decisionId: string,
  selection: any
): Promise<{ success: boolean; error?: string }> {
  // This would integrate with the DecisionManager and GameAutomationController
  // For now, we return success and let the automation continue
  try {
    const game = games.get(gameId);
    if (!game || !game.state) {
      return { success: false, error: "Game not found" };
    }
    
    // The actual decision processing would be done by the automation controller
    // For now, we just acknowledge the decision
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

// NOTE: processAttackers and processBlockers functions have been removed.
// Combat declaration logic is now centralized in combat.ts to prevent
// state corruption from duplicate handlers. See registerCombatHandlers().

/**
 * Process spell casting
 */
async function processCastSpell(
  gameId: string,
  playerId: string,
  spell: {
    cardId: string;
    targets?: string[];
    modes?: string[];
    xValue?: number;
    manaPayment?: Array<{ permanentId: string; manaColor: string }>;
  }
): Promise<{ success: boolean; error?: string; stack?: any[] }> {
  try {
    const game = games.get(gameId);
    if (!game || !game.state) {
      return { success: false, error: "Game not found" };
    }
    
    // Find card in hand
    const player = game.state.players.find((p: any) => p.id === playerId);
    if (!player) {
      return { success: false, error: "Player not found" };
    }
    
    const hand = (player as any).hand || [];
    const cardIndex = hand.findIndex((c: any) => c?.id === spell.cardId || c === spell.cardId);
    
    if (cardIndex === -1) {
      return { success: false, error: "Card not in hand" };
    }
    
    const card = hand[cardIndex];
    
    // Remove from hand
    hand.splice(cardIndex, 1);
    
    // Add to stack
    const stackItem = {
      id: `stack_${Date.now()}`,
      type: 'spell' as const,
      controller: playerId,
      card: card,
      targets: spell.targets || [],
    };
    
    const stack = [...(game.state.stack || []), stackItem];
    game.state.stack = stack;
    
    // Tap lands for mana payment
    if (spell.manaPayment) {
      const battlefield = game.state.battlefield || [];
      for (const payment of spell.manaPayment) {
        const land = battlefield.find((p: any) => p.id === payment.permanentId);
        if (land) {
          (land as any).tapped = true;
        }
      }
    }
    
    return { 
      success: true,
      stack: stack.map((s: any) => ({
        id: s.id,
        type: s.type,
        name: s.card?.name || 'Unknown',
        controller: s.controller,
        targets: s.targets,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Process ability activation
 */
async function processActivateAbility(
  gameId: string,
  playerId: string,
  ability: {
    permanentId: string;
    abilityIndex: number;
    targets?: string[];
    manaPayment?: Array<{ permanentId: string; manaColor: string }>;
  }
): Promise<{ success: boolean; error?: string; usesStack?: boolean; stack?: any[]; message?: string }> {
  try {
    const game = games.get(gameId);
    if (!game || !game.state) {
      return { success: false, error: "Game not found" };
    }
    
    // Find permanent
    const battlefield = game.state.battlefield || [];
    const perm = battlefield.find((p: any) => p.id === ability.permanentId);
    
    if (!perm) {
      return { success: false, error: "Permanent not found" };
    }
    
    // Check if it's a mana ability (doesn't use stack)
    const card = (perm as any).card;
    const cardName = (card?.name || '').toLowerCase();
    const oracleText = (card?.oracle_text || '').toLowerCase();
    const isManaAbility = oracleText.includes('add') && oracleText.includes('{t}:');
    
    // Import Crystal abilities dynamically to check
    const { getCrystalAbility, executeWindCrystalAbility, executeFireCrystalAbility, 
            executeWaterCrystalAbility, executeEarthCrystalAbility, executeDarknessCrystalAbility } = 
      await import("../state/modules/triggers/crystal-abilities.js");
    
    const crystalAbility = getCrystalAbility(cardName);
    
    // Handle Crystal abilities
    if (crystalAbility) {
      // Check if tapped (Crystals require tap)
      if (crystalAbility.requiresTap && (perm as any).tapped) {
        return { success: false, error: "Crystal is already tapped" };
      }
      
      // Tap the crystal
      (perm as any).tapped = true;
      
      // Execute the appropriate Crystal ability
      let result: { success: boolean; message?: string; error?: string } = { success: false };
      
      switch (cardName) {
        case 'the wind crystal':
          const windResult = executeWindCrystalAbility(game as any, playerId);
          result = { 
            success: windResult.success, 
            message: `The Wind Crystal: ${windResult.affectedCreatures.length} creatures gained flying and lifelink until end of turn` 
          };
          break;
          
        case 'the fire crystal':
          if (!ability.targets || ability.targets.length === 0) {
            return { success: false, error: "The Fire Crystal requires a target creature you control" };
          }
          const fireResult = executeFireCrystalAbility(game as any, playerId, ability.targets[0]);
          result = fireResult.success 
            ? { success: true, message: `The Fire Crystal: Created a token copy (will be sacrificed at end step)` }
            : { success: false, error: fireResult.error };
          break;
          
        case 'the water crystal':
          // No target needed - affects each opponent
          const waterResult = executeWaterCrystalAbility(game as any, playerId);
          if (waterResult.success) {
            const totalMilled = waterResult.results.reduce((sum, r) => sum + r.milledCount, 0);
            const opponentCount = waterResult.results.length;
            result = { 
              success: true, 
              message: `The Water Crystal: ${opponentCount} opponent(s) milled ${totalMilled} total cards` 
            };
          } else {
            result = { success: false, error: waterResult.error };
          }
          break;
          
        case 'the earth crystal':
          if (!ability.targets || ability.targets.length === 0) {
            return { success: false, error: "The Earth Crystal requires at least one target creature you control" };
          }
          if (ability.targets.length > 2) {
            return { success: false, error: "The Earth Crystal can only target up to two creatures" };
          }
          // Pass all targets (1 or 2 creatures) and optional distribution
          const earthResult = executeEarthCrystalAbility(
            game as any, 
            playerId, 
            ability.targets,
            (ability as any).distribution  // Optional: how to distribute the 2 counters
          );
          if (earthResult.success && earthResult.results) {
            const details = earthResult.results.map(r => `+${r.countersAdded}`).join(', ');
            result = { success: true, message: `The Earth Crystal: Distributed +1/+1 counters (${details})` };
          } else {
            result = { success: false, error: earthResult.error };
          }
          break;
          
        case 'the darkness crystal':
          if (!ability.targets || ability.targets.length === 0) {
            return { success: false, error: "The Darkness Crystal requires a target creature exiled with it" };
          }
          const darknessResult = executeDarknessCrystalAbility(
            game as any, 
            playerId, 
            ability.permanentId,  // The Crystal's permanent ID
            ability.targets[0]    // The exiled creature card ID
          );
          result = darknessResult.success
            ? { success: true, message: `The Darkness Crystal: Returned ${darknessResult.creatureName} to battlefield tapped with +2/+2` }
            : { success: false, error: darknessResult.error };
          break;
          
        default:
          return { success: false, error: "Unknown Crystal ability" };
      }
      
      if (!result.success) {
        // Untap the crystal if activation failed
        (perm as any).tapped = false;
        return { success: false, error: result.error || "Crystal ability failed" };
      }
      
      return { success: true, usesStack: false, message: result.message };
    }
    
    if (isManaAbility) {
      // Tap the permanent
      (perm as any).tapped = true;
      
      // Add mana to pool (simplified)
      const player = game.state.players.find((p: any) => p.id === playerId);
      if (player) {
        // Parse what mana it produces (simplified)
        const manaPool = (player as any).manaPool || { white: 0, blue: 0, black: 0, red: 0, green: 0, colorless: 0 };
        // For now, just add 1 colorless
        manaPool.colorless += 1;
        (player as any).manaPool = manaPool;
      }
      
      return { success: true, usesStack: false };
    }
    
    // Non-mana ability - add to stack
    const stackItem = {
      id: `ability_${Date.now()}`,
      type: 'ability' as const,
      controller: playerId,
      card: { name: `${card?.name} ability`, oracle_text: oracleText } as any,
      targets: ability.targets || [],
    };
    
    const stack = [...(game.state.stack || []), stackItem] as any;
    game.state.stack = stack;
    
    return { 
      success: true,
      usesStack: true,
      stack: stack.map((s: any) => ({
        id: s.id,
        type: s.type,
        name: s.card?.name || 'Ability',
        controller: s.controller,
        targets: s.targets,
      })),
    };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Process mulligan decision
 */
async function processMulliganDecision(
  gameId: string,
  playerId: string,
  keep: boolean
): Promise<{ success: boolean; error?: string }> {
  try {
    const game = games.get(gameId);
    if (!game || !game.state) {
      return { success: false, error: "Game not found" };
    }
    
    // This would integrate with the mulligan system
    // For now, we just return success
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Process mulligan bottom cards
 */
async function processMulliganBottom(
  gameId: string,
  playerId: string,
  cardIds: string[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const game = games.get(gameId);
    if (!game || !game.state) {
      return { success: false, error: "Game not found" };
    }
    
    const player = game.state.players.find((p: any) => p.id === playerId);
    if (!player) {
      return { success: false, error: "Player not found" };
    }
    
    const hand = (player as any).hand || [];
    const library = (player as any).library || [];
    
    // Remove cards from hand and put on bottom of library
    const cardsToBottom = [];
    for (const cardId of cardIds) {
      const idx = hand.findIndex((c: any) => c?.id === cardId || c === cardId);
      if (idx !== -1) {
        cardsToBottom.push(hand.splice(idx, 1)[0]);
      }
    }
    
    (player as any).hand = hand;
    (player as any).library = [...library, ...cardsToBottom];
    
    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Run an automation step and return results
 */
async function runAutomationStep(
  gameId: string,
  io: Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>
): Promise<{
  state: any;
  status: string;
  priorityPlayer?: string;
  pendingDecisions: any[];
  stateChanged: boolean;
}> {
  const game = games.get(gameId);
  if (!game || !game.state) {
    return {
      state: null,
      status: "completed",
      pendingDecisions: [],
      stateChanged: false,
    };
  }
  
  // This would integrate with the GameAutomationController
  // For now, we just return the current state
  return {
    state: game.state,
    status: "waiting_for_priority",
    priorityPlayer: game.state.players?.[game.state.priorityPlayerIndex || 0]?.id,
    pendingDecisions: [],
    stateChanged: true,
  };
}
