/**
 * socket/resolution.ts
 * 
 * Socket handlers for the unified Resolution System.
 * Handles client interaction with the ResolutionQueueManager.
 */

import type { Server, Socket } from "socket.io";
import { 
  ResolutionQueueManager, 
  ResolutionQueueEvent,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { ensureGame, broadcastGame, getPlayerName } from "./util.js";

/**
 * Register Resolution System socket handlers
 */
export function registerResolutionHandlers(io: Server, socket: Socket) {
  
  // =========================================================================
  // Query handlers - Get information about pending steps
  // =========================================================================
  
  /**
   * Get all pending resolution steps for a game
   */
  socket.on("getResolutionQueue", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    
    const summary = ResolutionQueueManager.getPendingSummary(gameId);
    const queue = ResolutionQueueManager.getQueue(gameId);
    
    // Filter steps to only show player's own steps (for privacy)
    const visibleSteps = pid 
      ? queue.steps.filter(s => s.playerId === pid)
      : [];
    
    socket.emit("resolutionQueueState", {
      gameId,
      hasPending: summary.hasPending,
      pendingCount: summary.pendingCount,
      pendingTypes: summary.pendingTypes,
      myPendingSteps: visibleSteps,
      seq: queue.seq,
    });
  });
  
  /**
   * Get the next resolution step for the current player
   */
  socket.on("getMyNextResolutionStep", ({ gameId }: { gameId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("noResolutionStep", { gameId });
      return;
    }
    
    const steps = ResolutionQueueManager.getStepsForPlayer(gameId, pid);
    const nextStep = steps.length > 0 ? steps[0] : undefined;
    
    if (nextStep) {
      socket.emit("resolutionStepPrompt", {
        gameId,
        step: sanitizeStepForClient(nextStep),
      });
    } else {
      socket.emit("noResolutionStep", { gameId });
    }
  });
  
  // =========================================================================
  // Action handlers - Respond to resolution steps
  // =========================================================================
  
  /**
   * Submit a response to a resolution step
   */
  socket.on("submitResolutionResponse", ({ 
    gameId, 
    stepId, 
    selections,
    cancelled = false,
  }: { 
    gameId: string; 
    stepId: string; 
    selections: string[] | number | boolean | Record<string, any>;
    cancelled?: boolean;
  }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized to respond" });
      return;
    }
    
    const game = ensureGame(gameId);
    if (!game) {
      socket.emit("error", { code: "GAME_NOT_FOUND", message: "Game not found" });
      return;
    }
    
    // Verify the step exists and belongs to this player
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find(s => s.id === stepId);
    
    if (!step) {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    
    if (step.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_STEP", message: "This is not your resolution step" });
      return;
    }
    
    // Create the response
    const response: ResolutionStepResponse = {
      stepId,
      playerId: pid,
      selections: selections as readonly string[] | number | boolean | Record<string, any>,
      cancelled,
      timestamp: Date.now(),
    };
    
    // Complete the step
    const completedStep = ResolutionQueueManager.completeStep(gameId, stepId, response);
    
    if (completedStep) {
      // Emit confirmation to the player
      socket.emit("resolutionStepCompleted", {
        gameId,
        stepId,
        success: true,
      });
      
      // Log the action
      console.log(`[Resolution] Step ${stepId} completed by ${pid}: ${completedStep.type}`);
      
      // Handle the response based on step type
      handleStepResponse(io, game, gameId, completedStep, response);
      
      // Broadcast updated game state
      broadcastGame(io, game, gameId);
      
      // Check if there are more steps for this player
      const remainingSteps = ResolutionQueueManager.getStepsForPlayer(gameId, pid);
      if (remainingSteps.length > 0) {
        socket.emit("resolutionStepPrompt", {
          gameId,
          step: sanitizeStepForClient(remainingSteps[0]),
        });
      }
    } else {
      socket.emit("error", { code: "STEP_COMPLETION_FAILED", message: "Failed to complete resolution step" });
    }
  });
  
  /**
   * Cancel/decline a resolution step (for non-mandatory steps)
   */
  socket.on("cancelResolutionStep", ({ gameId, stepId }: { gameId: string; stepId: string }) => {
    const pid = socket.data.playerId as string | undefined;
    if (!pid || socket.data.spectator) {
      socket.emit("error", { code: "NOT_AUTHORIZED", message: "Not authorized" });
      return;
    }
    
    const queue = ResolutionQueueManager.getQueue(gameId);
    const step = queue.steps.find(s => s.id === stepId);
    
    if (!step) {
      socket.emit("error", { code: "STEP_NOT_FOUND", message: "Resolution step not found" });
      return;
    }
    
    if (step.playerId !== pid) {
      socket.emit("error", { code: "NOT_YOUR_STEP", message: "This is not your resolution step" });
      return;
    }
    
    if (step.mandatory) {
      socket.emit("error", { code: "STEP_MANDATORY", message: "This step is mandatory and cannot be cancelled" });
      return;
    }
    
    // Cancel the step
    const cancelledStep = ResolutionQueueManager.cancelStep(gameId, stepId);
    
    if (cancelledStep) {
      socket.emit("resolutionStepCancelled", {
        gameId,
        stepId,
        success: true,
      });
      
      console.log(`[Resolution] Step ${stepId} cancelled by ${pid}: ${cancelledStep.type}`);
      
      const game = ensureGame(gameId);
      if (game) {
        broadcastGame(io, game, gameId);
      }
    }
  });
  
  // =========================================================================
  // Set up event forwarding from ResolutionQueueManager to Socket.IO
  // =========================================================================
  
  // This is done once per connection, forwarding queue events to the client
  const queueEventHandler = (
    event: ResolutionQueueEvent,
    eventGameId: string,
    step?: ResolutionStep,
    response?: ResolutionStepResponse
  ) => {
    // Only forward events for games this socket is in
    if (!socket.rooms.has(eventGameId)) return;
    
    switch (event) {
      case ResolutionQueueEvent.STEP_ADDED:
        if (step && step.playerId === socket.data.playerId) {
          // Notify player they have a new step to resolve
          socket.emit("resolutionStepPrompt", {
            gameId: eventGameId,
            step: sanitizeStepForClient(step),
          });
        }
        break;
        
      case ResolutionQueueEvent.QUEUE_CHANGED:
        // Notify client queue has changed (for UI updates)
        const summary = ResolutionQueueManager.getPendingSummary(eventGameId);
        socket.emit("resolutionQueueChanged", {
          gameId: eventGameId,
          hasPending: summary.hasPending,
          pendingCount: summary.pendingCount,
          pendingTypes: summary.pendingTypes,
        });
        break;
    }
  };
  
  // Register the event handler
  ResolutionQueueManager.on(queueEventHandler);
  
  // Clean up when socket disconnects
  socket.on("disconnect", () => {
    ResolutionQueueManager.off(queueEventHandler);
  });
}

/**
 * Sanitize a resolution step for sending to the client
 * Removes internal data and formats for client consumption
 */
function sanitizeStepForClient(step: ResolutionStep): any {
  return {
    id: step.id,
    type: step.type,
    playerId: step.playerId,
    description: step.description,
    mandatory: step.mandatory,
    sourceId: step.sourceId,
    sourceName: step.sourceName,
    sourceImage: step.sourceImage,
    createdAt: step.createdAt,
    timeoutMs: step.timeoutMs,
    // Include type-specific fields
    ...getTypeSpecificFields(step),
  };
}

/**
 * Get type-specific fields for a resolution step
 */
function getTypeSpecificFields(step: ResolutionStep): Record<string, any> {
  const fields: Record<string, any> = {};
  
  switch (step.type) {
    case ResolutionStepType.TARGET_SELECTION:
      if ('validTargets' in step) fields.validTargets = step.validTargets;
      if ('targetTypes' in step) fields.targetTypes = step.targetTypes;
      if ('minTargets' in step) fields.minTargets = step.minTargets;
      if ('maxTargets' in step) fields.maxTargets = step.maxTargets;
      if ('targetDescription' in step) fields.targetDescription = step.targetDescription;
      break;
      
    case ResolutionStepType.MODE_SELECTION:
      if ('modes' in step) fields.modes = step.modes;
      if ('minModes' in step) fields.minModes = step.minModes;
      if ('maxModes' in step) fields.maxModes = step.maxModes;
      if ('allowDuplicates' in step) fields.allowDuplicates = step.allowDuplicates;
      break;
      
    case ResolutionStepType.DISCARD_SELECTION:
      if ('hand' in step) fields.hand = step.hand;
      if ('discardCount' in step) fields.discardCount = step.discardCount;
      if ('currentHandSize' in step) fields.currentHandSize = step.currentHandSize;
      if ('maxHandSize' in step) fields.maxHandSize = step.maxHandSize;
      if ('reason' in step) fields.reason = step.reason;
      break;
      
    case ResolutionStepType.COMMANDER_ZONE_CHOICE:
      if ('commanderId' in step) fields.commanderId = step.commanderId;
      if ('commanderName' in step) fields.commanderName = step.commanderName;
      if ('fromZone' in step) fields.fromZone = step.fromZone;
      if ('card' in step) fields.card = step.card;
      break;
      
    case ResolutionStepType.TRIGGER_ORDER:
      if ('triggers' in step) fields.triggers = step.triggers;
      if ('requireAll' in step) fields.requireAll = step.requireAll;
      break;
      
    case ResolutionStepType.LIBRARY_SEARCH:
      if ('searchCriteria' in step) fields.searchCriteria = step.searchCriteria;
      if ('maxSelections' in step) fields.maxSelections = step.maxSelections;
      if ('destination' in step) fields.destination = step.destination;
      if ('reveal' in step) fields.reveal = step.reveal;
      if ('shuffleAfter' in step) fields.shuffleAfter = step.shuffleAfter;
      break;
      
    case ResolutionStepType.OPTION_CHOICE:
    case ResolutionStepType.MODAL_CHOICE:
      if ('options' in step) fields.options = step.options;
      if ('minSelections' in step) fields.minSelections = step.minSelections;
      if ('maxSelections' in step) fields.maxSelections = step.maxSelections;
      break;
      
    case ResolutionStepType.PONDER_EFFECT:
      if ('cards' in step) fields.cards = step.cards;
      if ('variant' in step) fields.variant = step.variant;
      if ('cardCount' in step) fields.cardCount = step.cardCount;
      if ('drawAfter' in step) fields.drawAfter = step.drawAfter;
      if ('mayShuffleAfter' in step) fields.mayShuffleAfter = step.mayShuffleAfter;
      break;
      
    case ResolutionStepType.SCRY:
      if ('cards' in step) fields.cards = step.cards;
      if ('scryCount' in step) fields.scryCount = step.scryCount;
      break;
      
    case ResolutionStepType.KYNAIOS_CHOICE:
      if ('isController' in step) fields.isController = step.isController;
      if ('sourceController' in step) fields.sourceController = step.sourceController;
      if ('canPlayLand' in step) fields.canPlayLand = step.canPlayLand;
      if ('landsInHand' in step) fields.landsInHand = step.landsInHand;
      if ('options' in step) fields.options = step.options;
      break;
  }
  
  return fields;
}

/**
 * Handle the response to a completed resolution step
 * This executes the game logic based on the player's choice
 */
function handleStepResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  if (response.cancelled) {
    // Step was cancelled - no action needed
    return;
  }
  
  const pid = response.playerId;
  
  switch (step.type) {
    case ResolutionStepType.DISCARD_SELECTION:
      handleDiscardResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.COMMANDER_ZONE_CHOICE:
      handleCommanderZoneResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TARGET_SELECTION:
      handleTargetSelectionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TRIGGER_ORDER:
      handleTriggerOrderResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.KYNAIOS_CHOICE:
      handleKynaiosChoiceResponse(io, game, gameId, step, response);
      break;
      
    // Add more handlers as needed
    default:
      console.log(`[Resolution] No specific handler for step type: ${step.type}`);
      // For steps with legacy data, try to process using old system
      if (step.legacyData) {
        console.log(`[Resolution] Step has legacy data, may need migration`);
      }
  }
}

/**
 * Handle discard selection response
 */
function handleDiscardResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  
  if (!Array.isArray(selections) || selections.length === 0) {
    console.warn(`[Resolution] Invalid discard selections for step ${step.id}`);
    return;
  }
  
  // Get player zones
  const zones = game.state?.zones?.[pid];
  if (!zones || !zones.hand) {
    console.warn(`[Resolution] No hand found for player ${pid}`);
    return;
  }
  
  // Move selected cards to graveyard
  zones.graveyard = zones.graveyard || [];
  
  for (const cardId of selections) {
    const cardIndex = zones.hand.findIndex((c: any) => c.id === cardId);
    if (cardIndex !== -1) {
      const [card] = zones.hand.splice(cardIndex, 1);
      zones.graveyard.push({ ...card, zone: 'graveyard' });
    }
  }
  
  // Update counts
  zones.handCount = zones.hand.length;
  zones.graveyardCount = zones.graveyard.length;
  
  // Clear legacy pending state if present
  if (game.state.pendingDiscardSelection?.[pid]) {
    delete game.state.pendingDiscardSelection[pid];
  }
  
  // Emit chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} discarded ${selections.length} card(s).`,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle commander zone choice response
 */
function handleCommanderZoneResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  // Check if selection indicates going to command zone
  // Handle multiple selection types
  const goToCommandZone = selection === true || 
    (typeof selection === 'string' && selection === 'command') ||
    (Array.isArray(selection) && selection.includes('command'));
  
  // Get the commander info from step
  const commanderId = (step as any).commanderId;
  const commanderName = (step as any).commanderName || 'Commander';
  const fromZone = (step as any).fromZone || 'graveyard';
  
  if (goToCommandZone) {
    // Move commander to command zone
    // Implementation depends on existing game state structure
    console.log(`[Resolution] Moving ${commanderName} to command zone`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} moved ${commanderName} to the command zone.`,
      ts: Date.now(),
    });
  } else {
    console.log(`[Resolution] ${commanderName} stays in ${fromZone}`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} let ${commanderName} go to ${fromZone}.`,
      ts: Date.now(),
    });
  }
  
  // Clear legacy pending state if present
  if (game.state.pendingCommanderZoneChoice?.[pid]) {
    const choices = game.state.pendingCommanderZoneChoice[pid];
    const index = choices.findIndex((c: any) => c.commanderId === commanderId);
    if (index !== -1) {
      choices.splice(index, 1);
      if (choices.length === 0) {
        delete game.state.pendingCommanderZoneChoice[pid];
      }
    }
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle target selection response
 */
function handleTargetSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  
  console.log(`[Resolution] Target selection: ${selections?.join(', ')}`);
  
  // Clear legacy pending state if present
  if (game.state.pendingTargets?.[pid]) {
    delete game.state.pendingTargets[pid];
  }
  
  // The actual target handling depends on what spell/ability needs the targets
  // This would typically be handled by the stack resolution system
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle trigger ordering response
 */
function handleTriggerOrderResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const orderedTriggerIds = response.selections as string[];
  
  console.log(`[Resolution] Trigger order: ${orderedTriggerIds?.join(', ')}`);
  
  // Clear legacy pending state if present
  if (game.state.pendingTriggerOrdering?.[pid]) {
    delete game.state.pendingTriggerOrdering[pid];
  }
  
  // The trigger ordering would be used to reorder triggers on the stack
  // This is typically handled by the stack system
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Kynaios and Tiro style choice response
 * Player can either play a land from hand, draw a card (opponents), or decline (controller)
 */
function handleKynaiosChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract choice and landCardId from selection
  let choice: string;
  let landCardId: string | undefined;
  
  if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    choice = (selection as any).choice || 'decline';
    landCardId = (selection as any).landCardId;
  } else if (Array.isArray(selection) && selection.length > 0) {
    choice = selection[0];
    landCardId = selection[1];
  } else {
    choice = String(selection || 'decline');
  }
  
  const stepData = step as any;
  const isController = stepData.isController || false;
  const sourceController = stepData.sourceController || pid;
  const sourceName = step.sourceName || 'Kynaios and Tiro of Meletis';
  
  console.log(`[Resolution] Kynaios choice: player=${pid}, choice=${choice}, landCardId=${landCardId}, isController=${isController}`);
  
  if (choice === 'play_land' && landCardId) {
    // Move the land from hand to battlefield
    const zones = game.state?.zones?.[pid];
    if (zones?.hand) {
      const cardIndex = zones.hand.findIndex((c: any) => c.id === landCardId);
      if (cardIndex !== -1) {
        const [card] = zones.hand.splice(cardIndex, 1);
        const cardName = card.name || 'a land';
        
        // Create battlefield permanent
        const permanentId = `perm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const permanent = {
          id: permanentId,
          controller: pid,
          owner: pid,
          tapped: false,
          counters: {},
          card: { ...card, zone: 'battlefield' },
        };
        
        // Add to battlefield
        game.state.battlefield = game.state.battlefield || [];
        game.state.battlefield.push(permanent);
        
        // Update zone counts
        zones.handCount = zones.hand.length;
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, pid)} puts ${cardName} onto the battlefield (${sourceName}).`,
          ts: Date.now(),
        });
        
        console.log(`[Resolution] ${pid} played land ${cardName} via Kynaios choice`);
      }
    }
  } else if (choice === 'draw_card' && !isController) {
    // Opponent chose to draw a card instead of playing a land
    game.state.pendingDraws = game.state.pendingDraws || {};
    game.state.pendingDraws[pid] = (game.state.pendingDraws[pid] || 0) + 1;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} chooses to draw a card instead of playing a land (${sourceName}).`,
      ts: Date.now(),
    });
    
    console.log(`[Resolution] ${pid} chose to draw via Kynaios choice`);
  } else {
    // Player declined
    if (!isController) {
      // Opponent who declined gets to draw
      game.state.pendingDraws = game.state.pendingDraws || {};
      game.state.pendingDraws[pid] = (game.state.pendingDraws[pid] || 0) + 1;
      
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} declines to play a land and draws a card (${sourceName}).`,
        ts: Date.now(),
      });
    } else {
      io.to(gameId).emit("chat", {
        id: `m_${Date.now()}`,
        gameId,
        from: "system",
        message: `${getPlayerName(game, pid)} declines to play a land (${sourceName}).`,
        ts: Date.now(),
      });
    }
    
    console.log(`[Resolution] ${pid} declined Kynaios land play option`);
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

export default { registerResolutionHandlers };
