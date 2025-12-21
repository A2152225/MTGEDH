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
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { handleBounceLandETB } from "./ai.js";
import type { PlayerID } from "../../../shared/src/types.js";

/**
 * Handle AI player resolution steps automatically
 * This is called when a step is added to check if it's for an AI player
 */
async function handleAIResolutionStep(
  io: Server,
  gameId: string,
  step: ResolutionStep
): Promise<void> {
  try {
    const game = ensureGame(gameId);
    if (!game) return;
    
    const player = (game.state?.players || []).find((p: any) => p.id === step.playerId);
    const isAI = player && (player as any).isAI;
    
    if (!isAI) return; // Not an AI player, skip
    
    debug(2, `[Resolution] AI player ${step.playerId} auto-resolving step: ${step.type}`);
    
    let response: ResolutionStepResponse | null = null;
    
    switch (step.type) {
      case ResolutionStepType.BOUNCE_LAND_CHOICE: {
        const stepData = step as any;
        const landsToChoose = stepData.landsToChoose || [];
        
        if (landsToChoose.length === 0) {
          debugWarn(1, `[Resolution] AI bounce land choice: no lands available`);
          break;
        }
        
        // Use existing AI logic to choose which land to return
        // We need to score the lands and pick the best one to return
        const battlefield = game.state.battlefield || [];
        const playerId = step.playerId;
        const bounceLandName = stepData.bounceLandName || 'Bounce Land';
        
        // Check for landfall synergy
        const hasLandfallSynergy = battlefield.some((perm: any) => {
          if (perm.controller !== playerId) return false;
          const oracleText = (perm.card?.oracle_text || '').toLowerCase();
          return oracleText.includes('landfall') || 
                 oracleText.includes('whenever a land enters') ||
                 oracleText.includes('whenever you play a land');
        });
        
        // Score each land option
        const scoredLands = landsToChoose.map((landOption: any) => {
          const perm = battlefield.find((p: any) => p.id === landOption.permanentId);
          if (!perm) return { landOption, score: 1000 }; // Not found, don't choose
          
          let score = 50; // Base score
          const card = perm.card;
          const typeLine = (card?.type_line || '').toLowerCase();
          const permName = (card?.name || '').toLowerCase();
          
          // The bounce land itself
          if (permName === bounceLandName.toLowerCase()) {
            if (landsToChoose.length === 1) {
              score = 0; // Only option
            } else {
              score += hasLandfallSynergy ? 10 : 30;
              if (perm.tapped) score -= 10;
            }
            return { landOption, score };
          }
          
          // Basic lands are least valuable
          if (typeLine.includes('basic')) {
            score -= 30;
            if (hasLandfallSynergy) score -= 10;
          }
          
          // Tapped lands are good to return
          if (perm.tapped) score -= 10;
          
          return { landOption, score };
        });
        
        // Sort by score (lowest first = return first)
        scoredLands.sort((a: any, b: any) => a.score - b.score);
        const chosenLand = scoredLands[0]?.landOption;
        
        if (chosenLand) {
          response = {
            stepId: step.id,
            playerId: step.playerId,
            selections: chosenLand.permanentId,
            cancelled: false,
            timestamp: Date.now(),
          };
          debug(2, `[Resolution] AI chose to return land: ${chosenLand.cardName}`);
        }
        break;
      }
      
      case ResolutionStepType.JOIN_FORCES: {
        // AI declines to contribute to Join Forces (simple strategy)
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: 0,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI declines to contribute to Join Forces`);
        break;
      }
      
      case ResolutionStepType.TEMPTING_OFFER: {
        // AI declines tempting offers (simple strategy)
        response = {
          stepId: step.id,
          playerId: step.playerId,
          selections: false,
          cancelled: false,
          timestamp: Date.now(),
        };
        debug(2, `[Resolution] AI declines tempting offer`);
        break;
      }
      
      // Add more AI handlers as needed
    }
    
    if (response) {
      // Complete the step with the AI's response
      const success = ResolutionQueueManager.completeStep(gameId, step.id, response);
      if (success) {
        // Trigger the response handler
        handleStepResponse(io, game, gameId, step, response);
        broadcastGame(io, game, gameId);
      }
    }
  } catch (error) {
    debugError(1, `[Resolution] Error handling AI resolution step:`, error);
  }
}

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
      debug(2, `[Resolution] Step ${stepId} completed by ${pid}: ${completedStep.type}`);
      
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
      
      debug(2, `[Resolution] Step ${stepId} cancelled by ${pid}: ${cancelledStep.type}`);
      
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
 * Initialize global AI resolution handler
 * Should be called once when server starts
 */
export function initializeAIResolutionHandler(io: Server): void {
  // Set up global handler for AI steps
  const aiHandler = (
    event: ResolutionQueueEvent,
    gameId: string,
    step?: ResolutionStep
  ) => {
    if (event === ResolutionQueueEvent.STEP_ADDED && step) {
      // Process AI steps asynchronously
      handleAIResolutionStep(io, gameId, step).catch(err => {
        debugError(1, `[Resolution] AI handler error:`, err);
      });
    }
  };
  
  ResolutionQueueManager.on(aiHandler);
  debug(1, '[Resolution] AI handler initialized');
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
      
    case ResolutionStepType.JOIN_FORCES:
      if ('cardName' in step) fields.cardName = step.cardName;
      if ('effectDescription' in step) fields.effectDescription = step.effectDescription;
      if ('cardImageUrl' in step) fields.cardImageUrl = step.cardImageUrl;
      if ('initiator' in step) fields.initiator = step.initiator;
      if ('availableMana' in step) fields.availableMana = step.availableMana;
      if ('isInitiator' in step) fields.isInitiator = step.isInitiator;
      break;
      
    case ResolutionStepType.TEMPTING_OFFER:
      if ('cardName' in step) fields.cardName = step.cardName;
      if ('effectDescription' in step) fields.effectDescription = step.effectDescription;
      if ('cardImageUrl' in step) fields.cardImageUrl = step.cardImageUrl;
      if ('initiator' in step) fields.initiator = step.initiator;
      if ('isOpponent' in step) fields.isOpponent = step.isOpponent;
      break;
      
    case ResolutionStepType.BOUNCE_LAND_CHOICE:
      if ('bounceLandId' in step) fields.bounceLandId = step.bounceLandId;
      if ('bounceLandName' in step) fields.bounceLandName = step.bounceLandName;
      if ('landsToChoose' in step) fields.landsToChoose = step.landsToChoose;
      if ('stackItemId' in step) fields.stackItemId = step.stackItemId;
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
      
    case ResolutionStepType.JOIN_FORCES:
      handleJoinForcesResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.TEMPTING_OFFER:
      handleTemptingOfferResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.BOUNCE_LAND_CHOICE:
      handleBounceLandChoiceResponse(io, game, gameId, step, response);
      break;
      
    // Add more handlers as needed
    default:
      debug(2, `[Resolution] No specific handler for step type: ${step.type}`);
      // For steps with legacy data, try to process using old system
      if (step.legacyData) {
        debug(2, `[Resolution] Step has legacy data, may need migration`);
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
    debugWarn(2, `[Resolution] Invalid discard selections for step ${step.id}`);
    return;
  }
  
  // Get player zones
  const zones = game.state?.zones?.[pid];
  if (!zones || !zones.hand) {
    debugWarn(2, `[Resolution] No hand found for player ${pid}`);
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
    debug(2, `[Resolution] Moving ${commanderName} to command zone`);
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} moved ${commanderName} to the command zone.`,
      ts: Date.now(),
    });
  } else {
    debug(2, `[Resolution] ${commanderName} stays in ${fromZone}`);
    
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
  
  debug(1, `[Resolution] Target selection: ${selections?.join(', ')}`);
  
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
  
  debug(1, `[Resolution] Trigger order: ${orderedTriggerIds?.join(', ')}`);
  
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
  
  debug(2, `[Resolution] Kynaios choice: player=${pid}, choice=${choice}, landCardId=${landCardId}, isController=${isController}`);
  
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
        
        debug(2, `[Resolution] ${pid} played land ${cardName} via Kynaios choice`);
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
    
    debug(2, `[Resolution] ${pid} chose to draw via Kynaios choice`);
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
    
    debug(2, `[Resolution] ${pid} declined Kynaios land play option`);
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Join Forces mana contribution response
 * Each player may pay any amount of mana to contribute to the effect
 */
function handleJoinForcesResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract contribution amount from selection
  let contribution = 0;
  if (typeof selection === 'number') {
    contribution = Math.max(0, Math.floor(selection));
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    contribution = Math.max(0, Math.floor((selection as any).amount || 0));
  }
  
  const stepData = step as any;
  const cardName = stepData.cardName || step.sourceName || 'Join Forces';
  const initiator = stepData.initiator;
  
  debug(1, `[Resolution] Join Forces: player=${pid} contributed ${contribution} mana to ${cardName}`);
  
  // Track contributions in game state for effect resolution
  game.state.joinForcesContributions = game.state.joinForcesContributions || {};
  game.state.joinForcesContributions[cardName] = game.state.joinForcesContributions[cardName] || { 
    total: 0, 
    byPlayer: {},
    initiator,
    cardName 
  };
  game.state.joinForcesContributions[cardName].total += contribution;
  game.state.joinForcesContributions[cardName].byPlayer[pid] = contribution;
  
  // Notify players of the contribution
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: contribution > 0 
      ? `${getPlayerName(game, pid)} contributes ${contribution} mana to ${cardName}.`
      : `${getPlayerName(game, pid)} declines to contribute mana to ${cardName}.`,
    ts: Date.now(),
  });
  
  // Check if all players have responded - if so, apply the effect
  const queue = ResolutionQueueManager.getQueue(gameId);
  const remainingJoinForcesSteps = queue.steps.filter(s => 
    s.type === ResolutionStepType.JOIN_FORCES && 
    (s as any).cardName === cardName
  );
  
  if (remainingJoinForcesSteps.length === 0) {
    // All players have responded - apply the Join Forces effect
    const contributions = game.state.joinForcesContributions[cardName];
    const total = contributions.total;
    
    applyJoinForcesEffect(io, game, gameId, cardName, total, contributions.byPlayer, initiator);
    
    // Clean up
    delete game.state.joinForcesContributions[cardName];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Apply the actual Join Forces effect based on total mana contributed
 */
function applyJoinForcesEffect(
  io: Server,
  game: any,
  gameId: string,
  cardName: string,
  totalContributions: number,
  byPlayer: Record<string, number>,
  initiator: string
): void {
  const cardNameLower = cardName.toLowerCase();
  const players = game.state?.players || [];
  const battlefield = game.state.battlefield = game.state.battlefield || [];
  
  debug(1, `[Resolution] Applying Join Forces effect: ${cardName} with ${totalContributions} total mana`);
  
  // Minds Aglow: Each player draws X cards
  if (cardNameLower.includes('minds aglow')) {
    for (const p of players) {
      if (p.hasLost) continue;
      game.state.pendingDraws = game.state.pendingDraws || {};
      game.state.pendingDraws[p.id] = (game.state.pendingDraws[p.id] || 0) + totalContributions;
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `📚 Minds Aglow: Each player draws ${totalContributions} cards!`,
      ts: Date.now(),
    });
  }
  // Collective Voyage: Each player may search for X basic lands
  else if (cardNameLower.includes('collective voyage')) {
    for (const p of players) {
      if (p.hasLost) continue;
      game.state.pendingLibrarySearch = game.state.pendingLibrarySearch || {};
      game.state.pendingLibrarySearch[p.id] = {
        type: 'join-forces-search',
        searchFor: `up to ${totalContributions} basic land card(s)`,
        destination: 'battlefield',
        tapped: true,
        optional: true,
        source: 'Collective Voyage',
        shuffleAfter: true,
        maxSelections: totalContributions,
        filter: { types: ['land'], subtypes: ['basic'] },
      };
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🌲 Collective Voyage: Each player may search for up to ${totalContributions} basic land cards!`,
      ts: Date.now(),
    });
  }
  // Alliance of Arms: Each player creates X Soldier tokens
  else if (cardNameLower.includes('alliance of arms')) {
    for (const p of players) {
      if (p.hasLost) continue;
      for (let i = 0; i < totalContributions; i++) {
        const tokenId = `tok_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_${i}`;
        battlefield.push({
          id: tokenId,
          controller: p.id,
          owner: p.id,
          tapped: false,
          counters: {},
          isToken: true,
          card: {
            id: tokenId,
            name: 'Soldier Token',
            type_line: 'Token Creature — Soldier',
            power: '1',
            toughness: '1',
            colors: ['W'],
          },
        });
      }
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `⚔️ Alliance of Arms: Each player creates ${totalContributions} 1/1 white Soldier tokens!`,
      ts: Date.now(),
    });
  }
  // Shared Trauma: Each player mills X cards
  else if (cardNameLower.includes('shared trauma')) {
    for (const p of players) {
      if (p.hasLost) continue;
      game.state.pendingMill = game.state.pendingMill || {};
      game.state.pendingMill[p.id] = (game.state.pendingMill[p.id] || 0) + totalContributions;
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `💀 Shared Trauma: Each player mills ${totalContributions} cards!`,
      ts: Date.now(),
    });
  }
  
  // Emit Join Forces complete event
  io.to(gameId).emit("joinForcesComplete", {
    id: `jf_${Date.now()}`,
    gameId,
    cardName,
    contributions: byPlayer,
    totalContributions,
    initiator,
  });
}

/**
 * Handle Tempting Offer accept/decline response
 * Each opponent may accept the tempting offer
 */
function handleTemptingOfferResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract acceptance from selection
  let accepted = false;
  if (typeof selection === 'boolean') {
    accepted = selection;
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    accepted = Boolean((selection as any).accept || (selection as any).accepted);
  } else if (typeof selection === 'string') {
    accepted = selection === 'accept' || selection === 'true';
  }
  
  const stepData = step as any;
  const cardName = stepData.cardName || step.sourceName || 'Tempting Offer';
  const initiator = stepData.initiator;
  
  debug(2, `[Resolution] Tempting Offer: player=${pid} ${accepted ? 'ACCEPTS' : 'DECLINES'} ${cardName}`);
  
  // Track responses in game state for effect resolution
  game.state.temptingOfferResponses = game.state.temptingOfferResponses || {};
  game.state.temptingOfferResponses[cardName] = game.state.temptingOfferResponses[cardName] || { 
    acceptedBy: [],
    initiator,
    cardName 
  };
  
  if (accepted) {
    game.state.temptingOfferResponses[cardName].acceptedBy.push(pid);
  }
  
  // Notify players of the response
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: accepted 
      ? `✅ ${getPlayerName(game, pid)} accepts the tempting offer from ${cardName}!`
      : `❌ ${getPlayerName(game, pid)} declines the tempting offer from ${cardName}.`,
    ts: Date.now(),
  });
  
  // Check if all opponents have responded - if so, apply the effect
  const queue = ResolutionQueueManager.getQueue(gameId);
  const remainingTemptingOfferSteps = queue.steps.filter(s => 
    s.type === ResolutionStepType.TEMPTING_OFFER && 
    (s as any).cardName === cardName
  );
  
  if (remainingTemptingOfferSteps.length === 0) {
    // All opponents have responded - apply the Tempting Offer effect
    const responses = game.state.temptingOfferResponses[cardName];
    const acceptedBy = responses.acceptedBy;
    const initiatorBonusCount = 1 + acceptedBy.length; // Initiator gets effect once plus for each acceptor
    
    applyTemptingOfferEffect(io, game, gameId, cardName, acceptedBy, initiator, initiatorBonusCount);
    
    // Clean up
    delete game.state.temptingOfferResponses[cardName];
  }
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Apply the actual Tempting Offer effect
 */
function applyTemptingOfferEffect(
  io: Server,
  game: any,
  gameId: string,
  cardName: string,
  acceptedBy: string[],
  initiator: string,
  initiatorBonusCount: number
): void {
  const cardNameLower = cardName.toLowerCase();
  const battlefield = game.state.battlefield = game.state.battlefield || [];
  
  debug(2, `[Resolution] Applying Tempting Offer effect: ${cardName}, ${acceptedBy.length} accepted, initiator gets ${initiatorBonusCount}x`);
  
  // Tempt with Discovery: Search for lands
  if (cardNameLower.includes('discovery')) {
    // Set up library search for initiator
    game.state.pendingLibrarySearch = game.state.pendingLibrarySearch || {};
    game.state.pendingLibrarySearch[initiator] = {
      type: 'tempting-offer-search',
      searchFor: `up to ${initiatorBonusCount} land card(s)`,
      destination: 'battlefield',
      tapped: false,
      optional: true,
      source: 'Tempt with Discovery',
      shuffleAfter: true,
      maxSelections: initiatorBonusCount,
      filter: { types: ['land'] },
    };
    
    // Each accepting opponent also searches
    for (const opponentId of acceptedBy) {
      game.state.pendingLibrarySearch[opponentId] = {
        type: 'tempting-offer-search',
        searchFor: 'a land card',
        destination: 'battlefield',
        tapped: false,
        optional: true,
        source: 'Tempt with Discovery',
        shuffleAfter: true,
        maxSelections: 1,
        filter: { types: ['land'] },
      };
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🌲 Tempt with Discovery: ${getPlayerName(game, initiator)} searches for up to ${initiatorBonusCount} land(s).${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) also search.` : ''}`,
      ts: Date.now(),
    });
  }
  // Tempt with Glory: +1/+1 counters
  else if (cardNameLower.includes('glory')) {
    // Initiator's creatures get counters
    const initiatorCreatures = battlefield.filter((p: any) => 
      p.controller === initiator && 
      (p.card?.type_line || '').toLowerCase().includes('creature')
    );
    for (const creature of initiatorCreatures) {
      creature.counters = creature.counters || {};
      creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + initiatorBonusCount;
    }
    
    // Each accepting opponent's creatures get 1 counter
    for (const opponentId of acceptedBy) {
      const opponentCreatures = battlefield.filter((p: any) => 
        p.controller === opponentId && 
        (p.card?.type_line || '').toLowerCase().includes('creature')
      );
      for (const creature of opponentCreatures) {
        creature.counters = creature.counters || {};
        creature.counters['+1/+1'] = (creature.counters['+1/+1'] || 0) + 1;
      }
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `✨ Tempt with Glory: ${getPlayerName(game, initiator)}'s creatures each get ${initiatorBonusCount} +1/+1 counter(s)!${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s)' creatures each get 1 counter.` : ''}`,
      ts: Date.now(),
    });
  }
  // Add more Tempting Offer cards as needed (Reflections, Vengeance, Immortality, Bunnies, Mayhem)
  else {
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `🎁 ${cardName}: ${getPlayerName(game, initiator)} gets the effect ${initiatorBonusCount} time(s).${acceptedBy.length > 0 ? ` ${acceptedBy.length} opponent(s) also get the effect.` : ''}`,
      ts: Date.now(),
    });
  }
  
  // Emit Tempting Offer complete event
  io.to(gameId).emit("temptingOfferComplete", {
    id: `tempt_${Date.now()}`,
    gameId,
    cardName,
    acceptedBy,
    initiator,
    initiatorBonusCount,
  });
}

/**
 * Handle Bounce Land Choice response
 * Player selects which land to return to hand when a bounce land enters the battlefield
 */
function handleBounceLandChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selection = response.selections;
  
  // Extract selected permanent ID from selection
  let returnPermanentId = '';
  if (typeof selection === 'string') {
    returnPermanentId = selection;
  } else if (Array.isArray(selection) && selection.length > 0) {
    returnPermanentId = selection[0];
  } else if (typeof selection === 'object' && selection !== null && !Array.isArray(selection)) {
    returnPermanentId = (selection as any).permanentId || (selection as any).returnPermanentId || '';
  }
  
  if (!returnPermanentId) {
    debugWarn(1, `[Resolution] Bounce land choice: no land selected by ${pid}`);
    return;
  }
  
  const stepData = step as any;
  const bounceLandId = stepData.bounceLandId;
  const bounceLandName = stepData.bounceLandName || 'Bounce Land';
  const stackItemId = stepData.stackItemId;
  
  debug(2, `[Resolution] Bounce land choice: player=${pid} returns land ${returnPermanentId}`);
  
  // Ensure game state and battlefield exist
  game.state = (game.state || {}) as any;
  game.state.battlefield = game.state.battlefield || [];
  
  const battlefield = game.state.battlefield;
  
  // Find the land to return
  const landToReturn = battlefield.find((p: any) => 
    p.id === returnPermanentId && p.controller === pid
  );
  
  if (!landToReturn) {
    debugWarn(1, `[Resolution] Land to return not found: ${returnPermanentId}`);
    return;
  }
  
  const returnedLandName = (landToReturn as any).card?.name || "Land";
  
  // Remove the land from battlefield
  const idx = battlefield.indexOf(landToReturn);
  if (idx !== -1) {
    battlefield.splice(idx, 1);
  }
  
  // Add the land to player's hand
  const zones = game.state?.zones?.[pid];
  if (zones) {
    zones.hand = zones.hand || [];
    const returnedCard = { ...(landToReturn as any).card, zone: 'hand' };
    (zones.hand as any[]).push(returnedCard);
    zones.handCount = (zones.hand as any[]).length;
  }
  
  // If this was triggered from the stack, remove the stack item
  if (stackItemId) {
    const stack = (game.state as any).stack || [];
    const stackIndex = stack.findIndex((item: any) => item.id === stackItemId);
    if (stackIndex !== -1) {
      stack.splice(stackIndex, 1);
      debug(2, `[Resolution] Removed bounce land trigger from stack (id: ${stackItemId})`);
    }
  }
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)}'s ${bounceLandName} returns ${returnedLandName} to hand.`,
    ts: Date.now(),
  });
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
}

export default { registerResolutionHandlers };

