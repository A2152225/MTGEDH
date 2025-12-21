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
import { parsePT } from "../state/utils.js";
import { debug, debugWarn, debugError } from "../utils/debug.js";
import { handleBounceLandETB } from "./ai.js";
import { appendEvent } from "../db/index.js";
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
        await handleStepResponse(io, game, gameId, step, response);
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
  socket.on("submitResolutionResponse", async ({ 
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
      await handleStepResponse(io, game, gameId, completedStep, response);
      
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
 * Initialize global priority management handler
 * Manages priority state during resolution per MTG Rule 608.2
 * Should be called once when server starts
 */
export function initializePriorityResolutionHandler(io: Server): void {
  // Import priority management functions
  import("../state/modules/priority.js").then(({ enterResolutionMode, exitResolutionMode }) => {
    const priorityHandler = (
      event: ResolutionQueueEvent,
      gameId: string,
      step?: ResolutionStep
    ) => {
      const game = ensureGame(gameId);
      if (!game) return;
      
      const ctx = (game as any).ctx || game;
      if (!ctx) return;
      
      // When first step is added, enter resolution mode (set priority = null)
      if (event === ResolutionQueueEvent.STEP_ADDED) {
        const summary = ResolutionQueueManager.getPendingSummary(gameId);
        // If this is the first step (count = 1), enter resolution mode
        if (summary.pendingCount === 1 && ctx.state.priority !== null) {
          enterResolutionMode(ctx);
          broadcastGame(io, game, gameId);
        }
      }
      
      // When last step completes, exit resolution mode (restore priority)
      if (event === ResolutionQueueEvent.STEP_COMPLETED) {
        const summary = ResolutionQueueManager.getPendingSummary(gameId);
        // If no more pending steps, exit resolution mode
        if (!summary.hasPending && ctx.state.priority === null) {
          exitResolutionMode(ctx);
          broadcastGame(io, game, gameId);
        }
      }
    };
    
    ResolutionQueueManager.on(priorityHandler);
    debug(1, '[Resolution] Priority management handler initialized');
  });
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
      if ('minSelections' in step) fields.minSelections = step.minSelections;
      if ('maxSelections' in step) fields.maxSelections = step.maxSelections;
      if ('destination' in step) fields.destination = step.destination;
      if ('reveal' in step) fields.reveal = step.reveal;
      if ('shuffleAfter' in step) fields.shuffleAfter = step.shuffleAfter;
      if ('remainderDestination' in step) fields.remainderDestination = step.remainderDestination;
      if ('remainderRandomOrder' in step) fields.remainderRandomOrder = step.remainderRandomOrder;
      if ('availableCards' in step) fields.availableCards = step.availableCards;
      if ('nonSelectableCards' in step) fields.nonSelectableCards = step.nonSelectableCards;
      if ('contextValue' in step) fields.contextValue = step.contextValue;
      if ('entersTapped' in step) fields.entersTapped = step.entersTapped;
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
      
    case ResolutionStepType.CASCADE:
      if ('cascadeNumber' in step) fields.cascadeNumber = step.cascadeNumber;
      if ('totalCascades' in step) fields.totalCascades = step.totalCascades;
      if ('manaValue' in step) fields.manaValue = step.manaValue;
      if ('hitCard' in step) fields.hitCard = step.hitCard;
      if ('exiledCards' in step) fields.exiledCards = step.exiledCards;
      if ('effectId' in step) fields.effectId = step.effectId;
      break;
      
    case ResolutionStepType.DEVOUR_SELECTION:
      if ('devourValue' in step) fields.devourValue = step.devourValue;
      if ('creatureId' in step) fields.creatureId = step.creatureId;
      if ('creatureName' in step) fields.creatureName = step.creatureName;
      if ('availableCreatures' in step) fields.availableCreatures = step.availableCreatures;
      break;
      
    case ResolutionStepType.SUSPEND_CAST:
      if ('card' in step) fields.card = step.card;
      if ('suspendCost' in step) fields.suspendCost = step.suspendCost;
      if ('timeCounters' in step) fields.timeCounters = step.timeCounters;
      break;
      
    case ResolutionStepType.MORPH_TURN_FACE_UP:
      if ('permanentId' in step) fields.permanentId = step.permanentId;
      if ('morphCost' in step) fields.morphCost = step.morphCost;
      if ('actualCard' in step) fields.actualCard = step.actualCard;
      if ('canAfford' in step) fields.canAfford = step.canAfford;
      break;
  }
  
  return fields;
}

/**
 * Handle the response to a completed resolution step
 * This executes the game logic based on the player's choice
 */
async function handleStepResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
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
      
    case ResolutionStepType.CASCADE:
      await handleCascadeResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SCRY:
      handleScryResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.LIBRARY_SEARCH:
      await handleLibrarySearchResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.DEVOUR_SELECTION:
      handleDevourSelectionResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.SUSPEND_CAST:
      await handleSuspendCastResponse(io, game, gameId, step, response);
      break;
      
    case ResolutionStepType.MORPH_TURN_FACE_UP:
      handleMorphTurnFaceUpResponse(io, game, gameId, step, response);
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
  
  // Get discard step data for validation
  const discardStep = step as any;
  const hand = discardStep.hand || [];
  const discardCount = discardStep.discardCount;
  
  // Validate selection count matches required discard count
  if (discardCount && selections.length !== discardCount) {
    debugWarn(1, `[Resolution] Invalid discard count: expected ${discardCount}, got ${selections.length}`);
    return;
  }
  
  // Validate all selected cards are in the hand options
  const validCardIds = new Set(hand.map((c: any) => c.id));
  for (const cardId of selections) {
    if (!validCardIds.has(cardId)) {
      debugWarn(1, `[Resolution] Invalid discard selection: card ${cardId} not in hand`);
      return;
    }
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
  const stepData = step as any;
  const commanderId = stepData.commanderId;
  const commanderName = stepData.commanderName || 'Commander';
  const fromZone = stepData.fromZone || 'graveyard';
  const card = stepData.card;
  
  if (goToCommandZone) {
    // Actually move commander to command zone
    const zones = game.state?.zones?.[pid];
    if (zones && card) {
      // Remove from source zone
      const sourceZone = zones[fromZone];
      if (Array.isArray(sourceZone)) {
        const cardIndex = sourceZone.findIndex((c: any) => c.id === commanderId || c.id === card.id);
        if (cardIndex !== -1) {
          sourceZone.splice(cardIndex, 1);
          // Update zone count
          const countKey = `${fromZone}Count` as keyof typeof zones;
          if (typeof zones[countKey] === 'number') {
            (zones[countKey] as number)--;
          }
        }
      }
      
      // Add to command zone
      zones.commandZone = zones.commandZone || [];
      zones.commandZone.push({ ...card, zone: 'command' });
      zones.commandZoneCount = zones.commandZone.length;
    }
    
    // Also remove from battlefield if present
    const battlefield = game.state?.battlefield || [];
    const permIndex = battlefield.findIndex((p: any) => 
      p.id === commanderId || p.card?.id === commanderId || p.card?.id === card?.id
    );
    if (permIndex !== -1) {
      battlefield.splice(permIndex, 1);
    }
    
    debug(2, `[Resolution] Moved ${commanderName} from ${fromZone} to command zone`);
    
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
  
  if (!Array.isArray(selections)) {
    debugWarn(1, `[Resolution] Invalid target selections: not an array`);
    return;
  }
  
  // Get target step data for validation
  const targetStep = step as any;
  const validTargets = targetStep.validTargets || [];
  const minTargets = targetStep.minTargets || 0;
  const maxTargets = targetStep.maxTargets || Infinity;
  
  // Validate selection count is within bounds
  if (selections.length < minTargets || selections.length > maxTargets) {
    debugWarn(1, `[Resolution] Invalid target count: got ${selections.length}, expected ${minTargets}-${maxTargets}`);
    return;
  }
  
  // Validate all selected targets are in valid targets list
  const validTargetIds = new Set(validTargets.map((t: any) => t.id));
  if (!selections.every(id => validTargetIds.has(id))) {
    debugWarn(1, `[Resolution] Invalid target selection: one or more targets not in valid targets list`);
    return;
  }
  
  // Store the validated targets on the stack item that needs them
  // The spell/ability on the stack will use these targets when it resolves
  const sourceId = step.sourceId;
  if (sourceId && game.state?.stack) {
    const stackItem = game.state.stack.find((item: any) => item.id === sourceId);
    if (stackItem) {
      stackItem.targets = selections;
      debug(2, `[Resolution] Stored targets for ${sourceId}: ${selections.join(', ')}`);
    } else {
      debugWarn(2, `[Resolution] Stack item ${sourceId} not found to store targets`);
    }
  }
  
  debug(1, `[Resolution] Target selection: ${selections?.join(', ')}`);
  
  // Clear legacy pending state if present
  if (game.state.pendingTargets?.[pid]) {
    delete game.state.pendingTargets[pid];
  }
  
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
  
  if (!Array.isArray(orderedTriggerIds)) {
    debugWarn(1, `[Resolution] Invalid trigger order: not an array`);
    return;
  }
  
  // Get trigger step data for validation
  const triggerStep = step as any;
  const triggers = triggerStep.triggers || [];
  const requireAll = triggerStep.requireAll !== false; // default true
  
  // Validate all trigger IDs are in the triggers list
  const validTriggerIds = new Set(triggers.map((t: any) => t.id));
  for (const triggerId of orderedTriggerIds) {
    if (!validTriggerIds.has(triggerId)) {
      debugWarn(1, `[Resolution] Invalid trigger ID in order: ${triggerId} not in valid triggers`);
      return;
    }
  }
  
  // If requireAll is true, ensure all triggers are included
  if (requireAll && orderedTriggerIds.length !== triggers.length) {
    debugWarn(1, `[Resolution] Invalid trigger order: expected all ${triggers.length} triggers, got ${orderedTriggerIds.length}`);
    return;
  }
  
  // Actually reorder the triggers on the stack
  // Triggers are put on the stack in the order specified (first in list = first to resolve = last on stack)
  // So we need to reverse the order when putting on stack
  const stack = game.state?.stack || [];
  
  // Find the trigger items on the stack by ID or triggerId
  // We check both because triggers might be stored with either field
  const foundTriggerItems = orderedTriggerIds.map(id => 
    stack.find((item: any) => item.id === id || item.triggerId === id)
  ).filter(Boolean);
  
  if (foundTriggerItems.length > 0) {
    // Remove all these triggers from stack
    for (const trigger of foundTriggerItems) {
      const idx = stack.indexOf(trigger);
      if (idx !== -1) {
        stack.splice(idx, 1);
      }
    }
    
    // Add them back in reverse order (last chosen = top of stack = resolves first)
    for (let i = foundTriggerItems.length - 1; i >= 0; i--) {
      stack.unshift(foundTriggerItems[i]);
    }
    
    debug(1, `[Resolution] Reordered ${foundTriggerItems.length} triggers on stack`);
  } else {
    debugWarn(2, `[Resolution] No trigger items found on stack to reorder`);
  }
  
  debug(1, `[Resolution] Trigger order: ${orderedTriggerIds?.join(', ')}`);
  
  // Clear legacy pending state if present
  if (game.state.pendingTriggerOrdering?.[pid]) {
    delete game.state.pendingTriggerOrdering[pid];
  }
  
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
  const canPlayLand = stepData.canPlayLand !== false; // default true if not specified
  const landsInHand = stepData.landsInHand || [];
  const options = stepData.options || ['play_land', 'draw_card', 'decline'];
  
  // Validate choice is in allowed options
  if (!options.includes(choice as any)) {
    debugWarn(1, `[Resolution] Invalid Kynaios choice: ${choice} not in allowed options`);
    return;
  }
  
  debug(2, `[Resolution] Kynaios choice: player=${pid}, choice=${choice}, landCardId=${landCardId}, isController=${isController}`);
  
  if (choice === 'play_land' && landCardId) {
    // Validate player can play land
    if (!canPlayLand) {
      debugWarn(1, `[Resolution] Kynaios: player ${pid} cannot play land`);
      return;
    }
    
    // Validate landCardId is in landsInHand list
    const isValidLand = landsInHand.some((land: any) => land.id === landCardId);
    if (!isValidLand) {
      debugWarn(1, `[Resolution] Invalid Kynaios land choice: ${landCardId} not in hand`);
      return;
    }
    
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
  const availableMana = stepData.availableMana || 0;
  
  // Validate contribution doesn't exceed available mana
  if (contribution > availableMana) {
    debugWarn(1, `[Resolution] Join Forces: contribution ${contribution} exceeds available mana ${availableMana} for player ${pid}`);
    return; // Reject invalid contribution
  }
  
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
  const landsToChoose = stepData.landsToChoose || [];
  
  debug(2, `[Resolution] Bounce land choice: player=${pid} returns land ${returnPermanentId}`);
  
  // Validate that the selected land is in the list of valid choices
  const validLandIds = new Set(landsToChoose.map((land: any) => land.permanentId));
  if (!validLandIds.has(returnPermanentId)) {
    debugWarn(1, `[Resolution] Invalid bounce land choice: ${returnPermanentId} not in valid options`);
    return;
  }
  
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
  
  // NOTE: Priority restoration is handled automatically by the ResolutionQueue system
  // via the priority management handler (initializePriorityResolutionHandler).
  // When the last resolution step completes, exitResolutionMode() is called automatically.
  
  // Bump sequence
  if (typeof (game as any).bumpSeq === "function") {
    (game as any).bumpSeq();
  }
}

/**
 * Handle cascade resolution response
 * Player chooses whether to cast the hit card or decline
 */
async function handleCascadeResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  // selections can be true (legacy), 'cast', or 'decline'
  const cast = response.selections === true || 
    (typeof response.selections === 'string' && response.selections === 'cast');
  
  const cascadeStep = step as any;
  const effectId = cascadeStep.effectId;
  const hitCard = cascadeStep.hitCard;
  const exiledCards = cascadeStep.exiledCards || [];
  
  debug(2, `[Resolution] Cascade response: player=${pid}, cast=${cast}, effectId=${effectId}`);
  
  // Get library and zones
  const lib = (game as any).libraries?.get(pid) || [];
  const zones = game.state.zones = game.state.zones || {};
  const z = zones[pid] = zones[pid] || { 
    hand: [], 
    handCount: 0, 
    libraryCount: lib.length, 
    graveyard: [], 
    graveyardCount: 0 
  };
  
  // Bottom the exiled cards (excluding hit card if casting)
  const randomized = [...exiledCards];
  for (let i = randomized.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [randomized[i], randomized[j]] = [randomized[j], randomized[i]];
  }
  
  for (const card of randomized) {
    if (cast && hitCard && card.id === hitCard.id) continue;
    lib.push({ ...card, zone: 'library' });
  }
  z.libraryCount = lib.length;
  
  // Cast the hit card if chosen
  if (cast && hitCard) {
    if (typeof game.applyEvent === 'function') {
      game.applyEvent({
        type: "castSpell",
        playerId: pid,
        card: { ...hitCard },
      });
    }
    
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, "castSpell", { 
        playerId: pid, 
        cardId: hitCard.id, 
        card: hitCard, 
        cascade: true 
      });
    } catch {
      // ignore persistence failures
    }
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} casts ${hitCard.name} via Cascade.`,
      ts: Date.now(),
    });
  } else if (hitCard) {
    // Declined casting - put the hit card on bottom as well
    lib.push({ ...hitCard, zone: 'library' });
    z.libraryCount = lib.length;
    
    io.to(gameId).emit("chat", {
      id: `m_${Date.now()}`,
      gameId,
      from: "system",
      message: `${getPlayerName(game, pid)} declines to cast ${hitCard.name} via Cascade.`,
      ts: Date.now(),
    });
  }
  
  // Emit cascade complete
  io.to(gameId).emit("cascadeComplete", { gameId, effectId });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Scry resolution response
 * 
 * Player looks at the top N cards of their library and decides which to keep
 * on top (in order) and which to put on the bottom (in order).
 * 
 * Reference: Rule 701.22 - Scry
 */
function handleScryResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as any;
  
  // Expected format: { keepTopOrder: KnownCardRef[], bottomOrder: KnownCardRef[] }
  const keepTopOrder = selections?.keepTopOrder || [];
  const bottomOrder = selections?.bottomOrder || [];
  
  const scryStep = step as any;
  const scryCount = scryStep.scryCount || 0;
  const cards = scryStep.cards || [];
  
  debug(2, `[Resolution] Scry response: player=${pid}, scryCount=${scryCount}, keepTop=${keepTopOrder.length}, bottom=${bottomOrder.length}`);
  
  // Validate that all cards are accounted for
  const totalCards = keepTopOrder.length + bottomOrder.length;
  if (totalCards !== scryCount && totalCards !== cards.length) {
    debugWarn(2, `[Resolution] Scry card count mismatch: expected ${scryCount}, got ${totalCards}`);
  }
  
  // Validate that the cards match what was shown
  const selectedIds = [...keepTopOrder, ...bottomOrder].map((c: any) => c.id);
  const cardIds = cards.map((c: any) => c.id);
  const allMatch = selectedIds.every((id: string) => cardIds.includes(id));
  
  if (!allMatch) {
    debugWarn(2, `[Resolution] Scry selection contains cards not in original set`);
  }
  
  // Apply the scry event to the game
  if (typeof game.applyEvent === 'function') {
    game.applyEvent({
      type: "scryResolve",
      playerId: pid,
      keepTopOrder,
      bottomOrder,
    });
  }
  
  // Log to event history
  try {
    appendEvent(gameId, game.seq ?? 0, "scryResolve", { 
      playerId: pid, 
      keepTopOrder, 
      bottomOrder 
    });
  } catch {
    // Ignore persistence failures
  }
  
  // Emit chat message
  const topCount = keepTopOrder.length;
  const bottomCount = bottomOrder.length;
  let message = `${getPlayerName(game, pid)} scries ${scryCount}`;
  if (topCount > 0 && bottomCount > 0) {
    message += ` (${topCount} on top, ${bottomCount} on bottom)`;
  } else if (topCount > 0) {
    message += ` (all on top)`;
  } else if (bottomCount > 0) {
    message += ` (all on bottom)`;
  }
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Library Search resolution response
 * Generic handler for effects that reveal/search library and select cards
 * Used for: Genesis Wave, tutors, Impulse, etc.
 * 
 * The handler uses the step parameters to determine:
 * - What cards are available (availableCards)
 * - Where selected cards go (destination)
 * - Where unselected cards go (remainderDestination)
 * - Whether to shuffle after (shuffleAfter)
 */
async function handleLibrarySearchResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[]; // Array of card IDs selected
  
  const searchStep = step as any;
  const availableCards = searchStep.availableCards || [];
  const nonSelectableCards = searchStep.nonSelectableCards || [];
  const destination = searchStep.destination || 'hand';
  const remainderDestination = searchStep.remainderDestination || 'shuffle';
  const remainderRandomOrder = searchStep.remainderRandomOrder !== false; // default true
  const shuffleAfter = searchStep.shuffleAfter !== false; // default true
  const contextValue = searchStep.contextValue;
  const entersTapped = searchStep.entersTapped || false;
  const sourceName = step.sourceName || 'Library Search';
  
  debug(2, `[Resolution] Library search response: player=${pid}, selected ${Array.isArray(selections) ? selections.length : 0} from ${availableCards.length} available, destination=${destination}, remainder=${remainderDestination}`);
  
  // Validate selections if any
  const selectedIds = Array.isArray(selections) ? selections : [];
  const availableIds = new Set(availableCards.map((c: any) => c.id));
  for (const cardId of selectedIds) {
    if (!availableIds.has(cardId)) {
      debugWarn(1, `[Resolution] Invalid library search selection: ${cardId} not in available cards`);
      return;
    }
  }
  
  // Get game context and utilities
  const { uid, parsePT, cardManaValue, applyCounterModifications } = await import("../state/utils.js");
  const { getETBTriggersForPermanent, detectEntersWithCounters } = await import("../state/modules/triggered-abilities.js");
  const { triggerETBEffectsForPermanent } = await import("../state/modules/stack.js");
  const { creatureWillHaveHaste, checkCreatureEntersTapped } = await import("./land-helpers.js");
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  const zones = state.zones = state.zones || {};
  const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
  const lib = (game as any).libraries?.get(pid) || [];
  
  // Create a map of card ID to full card data
  const allRevealedCards = [...availableCards, ...nonSelectableCards];
  const cardMap = new Map(allRevealedCards.map((c: any) => [c.id, c]));
  
  // Process selected cards based on destination
  for (const cardId of selectedIds) {
    const card = cardMap.get(cardId);
    if (!card) continue;
    
    if (destination === 'battlefield') {
      // Put onto battlefield (used by Genesis Wave, etc.)
      await putCardOntoBattlefield(card, pid, entersTapped, state, battlefield, uid, parsePT, cardManaValue, applyCounterModifications, getETBTriggersForPermanent, triggerETBEffectsForPermanent, detectEntersWithCounters, creatureWillHaveHaste, checkCreatureEntersTapped, game);
      debug(2, `[Resolution] ${sourceName}: Put ${card.name} onto battlefield`);
    } else if (destination === 'hand') {
      z.hand = z.hand || [];
      z.hand.push({ ...card, zone: 'hand' });
      z.handCount = z.hand.length;
      debug(2, `[Resolution] ${sourceName}: Put ${card.name} into hand`);
    } else if (destination === 'graveyard') {
      z.graveyard = z.graveyard || [];
      z.graveyard.push({ ...card, zone: 'graveyard' });
      z.graveyardCount = z.graveyard.length;
      debug(2, `[Resolution] ${sourceName}: Put ${card.name} into graveyard`);
    } else if (destination === 'exile') {
      z.exile = z.exile || [];
      z.exile.push({ ...card, zone: 'exile' });
      z.exileCount = z.exile.length;
      debug(2, `[Resolution] ${sourceName}: Exiled ${card.name}`);
    } else if (destination === 'top') {
      lib.unshift({ ...card, zone: 'library' });
      debug(2, `[Resolution] ${sourceName}: Put ${card.name} on top of library`);
    } else if (destination === 'bottom') {
      lib.push({ ...card, zone: 'library' });
      debug(2, `[Resolution] ${sourceName}: Put ${card.name} on bottom of library`);
    }
  }
  
  // Handle unselected cards (remainder)
  const unselectedCards = allRevealedCards.filter((c: any) => !selectedIds.includes(c.id));
  
  if (remainderDestination === 'graveyard') {
    z.graveyard = z.graveyard || [];
    for (const card of unselectedCards) {
      z.graveyard.push({ ...card, zone: 'graveyard' });
    }
    z.graveyardCount = z.graveyard.length;
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards into graveyard`);
  } else if (remainderDestination === 'bottom') {
    const cardsToBottom = remainderRandomOrder 
      ? [...unselectedCards].sort(() => Math.random() - 0.5)
      : unselectedCards;
    for (const card of cardsToBottom) {
      lib.push({ ...card, zone: 'library' });
    }
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards on bottom${remainderRandomOrder ? ' in random order' : ''}`);
  } else if (remainderDestination === 'top') {
    const cardsToTop = remainderRandomOrder 
      ? [...unselectedCards].sort(() => Math.random() - 0.5)
      : unselectedCards;
    for (const card of cardsToTop.reverse()) {
      lib.unshift({ ...card, zone: 'library' });
    }
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards on top${remainderRandomOrder ? ' in random order' : ''}`);
  } else if (remainderDestination === 'shuffle' || remainderDestination === 'hand') {
    // Put back in library and shuffle, or to hand
    if (remainderDestination === 'hand') {
      z.hand = z.hand || [];
      for (const card of unselectedCards) {
        z.hand.push({ ...card, zone: 'hand' });
      }
      z.handCount = z.hand.length;
    } else {
      for (const card of unselectedCards) {
        lib.push({ ...card, zone: 'library' });
      }
    }
  }
  
  // Shuffle if required
  if (shuffleAfter && lib.length > 0) {
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
    debug(2, `[Resolution] ${sourceName}: Shuffled library`);
  }
  
  // Update library count
  z.libraryCount = lib.length;
  
  // Send appropriate chat message
  const selectedCount = selectedIds.length;
  const totalRevealed = allRevealedCards.length;
  
  let message = `${getPlayerName(game, pid)} `;
  if (sourceName.toLowerCase().includes('genesis wave')) {
    message += `revealed ${totalRevealed} cards with Genesis Wave (X=${contextValue || '?'}), put ${selectedCount} permanent(s) onto the battlefield`;
    if (remainderDestination === 'graveyard') {
      message += `, and ${unselectedCards.length} card(s) into the graveyard`;
    }
  } else {
    message += `${sourceName}: selected ${selectedCount} of ${availableCards.length} card(s)`;
    if (destination === 'hand') message += ' to hand';
    else if (destination === 'battlefield') message += ' onto the battlefield';
    else if (destination === 'graveyard') message += ' to graveyard';
  }
  message += '.';
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Helper function to put a card onto the battlefield
 * Handles creatures, planeswalkers, and triggers
 */
async function putCardOntoBattlefield(
  card: any,
  controller: string,
  entersTapped: boolean,
  state: any,
  battlefield: any[],
  uid: any,
  parsePT: any,
  cardManaValue: any,
  applyCounterModifications: any,
  getETBTriggersForPermanent: any,
  triggerETBEffectsForPermanent: any,
  detectEntersWithCounters: any,
  creatureWillHaveHaste: any,
  checkCreatureEntersTapped: any,
  game: any
): Promise<void> {
  const tl = (card.type_line || '').toLowerCase();
  const isCreature = tl.includes('creature');
  const isPlaneswalker = tl.includes('planeswalker');
  const baseP = isCreature ? parsePT((card as any).power) : undefined;
  const baseT = isCreature ? parsePT((card as any).toughness) : undefined;
  const hasHaste = isCreature && creatureWillHaveHaste(card, controller, battlefield);
  const hasSummoningSickness = isCreature && !hasHaste;
  let shouldEnterTapped = entersTapped;
  if (isCreature && !entersTapped) {
    shouldEnterTapped = checkCreatureEntersTapped(battlefield, controller, card);
  }
  
  const initialCounters: Record<string, number> = {};
  if (isPlaneswalker && card.loyalty) {
    const startingLoyalty = typeof card.loyalty === 'number' ? card.loyalty : parseInt(card.loyalty, 10);
    if (!isNaN(startingLoyalty)) {
      initialCounters.loyalty = startingLoyalty;
    }
  }
  const etbCounters = detectEntersWithCounters(card);
  for (const [counterType, count] of Object.entries(etbCounters)) {
    initialCounters[counterType] = (initialCounters[counterType] || 0) + count;
  }
  
  const tempId = uid("perm");
  const tempPerm = { id: tempId, controller, counters: {} };
  battlefield.push(tempPerm as any);
  const modifiedCounters = applyCounterModifications(state, tempId, initialCounters);
  battlefield.pop();
  
  const newPermanent = {
    id: tempId,
    controller,
    owner: controller,
    tapped: shouldEnterTapped,
    counters: Object.keys(modifiedCounters).length > 0 ? modifiedCounters : undefined,
    basePower: baseP,
    baseToughness: baseT,
    summoningSickness: hasSummoningSickness,
    card: { ...card, zone: "battlefield" },
  } as any;
  
  battlefield.push(newPermanent);
  
  // Self ETB triggers
  const selfETBTriggerTypes = new Set([
    'etb',
    'etb_modal_choice',
    'job_select',
    'living_weapon',
    'etb_sacrifice_unless_pay',
    'etb_bounce_land',
    'etb_gain_life',
    'etb_draw',
    'etb_search',
    'etb_create_token',
    'etb_counter',
  ]);
  const allTriggers = getETBTriggersForPermanent(card, newPermanent);
  for (const trigger of allTriggers) {
    if (selfETBTriggerTypes.has(trigger.triggerType)) {
      state.stack = state.stack || [];
      state.stack.push({
        id: uid("trigger"),
        type: 'triggered_ability',
        controller,
        source: newPermanent.id,
        sourceName: trigger.cardName,
        description: trigger.description,
        triggerType: trigger.triggerType,
        mandatory: trigger.mandatory,
        permanentId: newPermanent.id,
      } as any);
    }
  }
  
  // Triggers from other permanents (landfall, etc.)
  const ctx = { 
    state, 
    gameId: (game as any).gameId,
    inactive: new Set(), 
    libraries: (game as any).libraries, 
    players: state.players 
  };
  triggerETBEffectsForPermanent(ctx as any, newPermanent, controller);
}

/**
 * Handle Devour Selection response
 * Player chooses creatures to sacrifice when a creature with Devour X enters
 */
function handleDevourSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const selections = response.selections as string[]; // Array of creature IDs to sacrifice
  
  const devourStep = step as any;
  const devourValue = devourStep.devourValue || 0;
  const creatureId = devourStep.creatureId;
  const availableCreatures = devourStep.availableCreatures || [];
  
  debug(2, `[Resolution] Devour selection: player=${pid}, devour=${devourValue}, selected ${Array.isArray(selections) ? selections.length : 0} creatures`);
  
  // Validate selections if any
  const selectedIds = Array.isArray(selections) ? selections : [];
  const availableIds = new Set(availableCreatures.map((c: any) => c.permanentId));
  for (const creatureIdToSac of selectedIds) {
    if (!availableIds.has(creatureIdToSac)) {
      debugWarn(1, `[Resolution] Invalid devour selection: ${creatureIdToSac} not in available creatures`);
      return;
    }
  }
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  
  // Find the devouring creature
  const devouringCreature = battlefield.find((p: any) => p.id === creatureId);
  if (!devouringCreature) {
    debugWarn(1, `[Resolution] Devour: creature ${creatureId} not found on battlefield`);
    return;
  }
  
  // Sacrifice selected creatures
  for (const creatureIdToSac of selectedIds) {
    const idx = battlefield.findIndex((p: any) => p.id === creatureIdToSac);
    if (idx !== -1) {
      const sacrificed = battlefield.splice(idx, 1)[0];
      const sacCard = (sacrificed as any).card;
      const owner = (sacrificed as any).owner || pid;
      
      // Move to graveyard
      const zones = state.zones = state.zones || {};
      const z = zones[owner] = zones[owner] || { graveyard: [], graveyardCount: 0 };
      z.graveyard = z.graveyard || [];
      z.graveyard.push({ ...sacCard, zone: 'graveyard' });
      z.graveyardCount = z.graveyard.length;
      
      debug(2, `[Resolution] Devour: Sacrificed ${sacCard.name || 'creature'}`);
      
      // TODO: Trigger death effects for sacrificed creature
    }
  }
  
  // Add +1/+1 counters to the devouring creature
  const countersToAdd = devourValue * selectedIds.length;
  if (countersToAdd > 0) {
    devouringCreature.counters = devouringCreature.counters || {};
    devouringCreature.counters['+1/+1'] = (devouringCreature.counters['+1/+1'] || 0) + countersToAdd;
    debug(2, `[Resolution] Devour: Added ${countersToAdd} +1/+1 counters to ${devourStep.creatureName}`);
  }
  
  // Send chat message
  const counterText = countersToAdd > 0 ? `, gaining ${countersToAdd} +1/+1 counter${countersToAdd > 1 ? 's' : ''}` : '';
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} sacrificed ${selectedIds.length} creature${selectedIds.length !== 1 ? 's' : ''} to ${devourStep.creatureName}${counterText}.`,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Suspend Cast response
 * Player casts a spell with suspend (exile with time counters)
 */
async function handleSuspendCastResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const suspendStep = step as any;
  const card = suspendStep.card;
  const timeCounters = suspendStep.timeCounters || 0;
  
  debug(2, `[Resolution] Suspend cast: player=${pid}, card=${card.name}, timeCounters=${timeCounters}`);
  
  // Remove card from hand
  const state = game.state || {};
  const zones = state.zones = state.zones || {};
  const z = zones[pid] = zones[pid] || { hand: [], handCount: 0, exile: [], exileCount: 0 };
  
  const handIdx = (z.hand || []).findIndex((c: any) => c.id === card.id);
  if (handIdx !== -1) {
    z.hand.splice(handIdx, 1);
    z.handCount = z.hand.length;
  }
  
  // Exile the card with time counters
  z.exile = z.exile || [];
  z.exile.push({
    ...card,
    zone: 'exile',
    isSuspended: true,
    timeCounters: timeCounters,
    suspendedBy: pid,
  });
  z.exileCount = z.exile.length;
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} suspended ${card.name} with ${timeCounters} time counter${timeCounters !== 1 ? 's' : ''}.`,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Handle Morph Turn Face-Up response
 * Player turns a face-down creature face-up
 */
function handleMorphTurnFaceUpResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): void {
  const pid = response.playerId;
  const morphStep = step as any;
  const permanentId = morphStep.permanentId;
  const actualCard = morphStep.actualCard;
  
  if (response.cancelled) {
    debug(2, `[Resolution] Morph turn face-up cancelled for ${permanentId}`);
    return;
  }
  
  debug(2, `[Resolution] Morph turn face-up: player=${pid}, permanent=${permanentId}`);
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  
  // Find the face-down creature
  const creature = battlefield.find((p: any) => p.id === permanentId);
  if (!creature) {
    debugWarn(1, `[Resolution] Morph: creature ${permanentId} not found on battlefield`);
    return;
  }
  
  if (!creature.isFaceDown) {
    debugWarn(1, `[Resolution] Morph: creature ${permanentId} is not face-down`);
    return;
  }
  
  // Turn face-up
  creature.isFaceDown = false;
  creature.card = actualCard;
  
  // Update power/toughness from 2/2 to actual values
  const tl = (actualCard.type_line || '').toLowerCase();
  const isCreature = tl.includes('creature');
  if (isCreature) {
    creature.basePower = parsePT((actualCard as any).power);
    creature.baseToughness = parsePT((actualCard as any).toughness);
  }
  
  // Remove face-down specific properties
  delete creature.faceDownType;
  delete creature.morphCost;
  delete creature.faceUpCard;
  
  // Send chat message
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message: `${getPlayerName(game, pid)} turned ${actualCard.name} face-up.`,
    ts: Date.now(),
  });
  
  // TODO: Trigger any morph/megamorph abilities
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

/**
 * Process pending cascade triggers and migrate them to the resolution queue
 * This is called after spell resolution to check for cascades
 */
export async function processPendingCascades(
  io: Server,
  game: any,
  gameId: string
): Promise<void> {
  try {
    const pending = (game.state as any).pendingCascade;
    if (!pending) return;
    
    const { cardManaValue, uid } = await import("../state/utils.js");
    
    for (const playerId of Object.keys(pending)) {
      const queue = pending[playerId];
      if (!Array.isArray(queue) || queue.length === 0) continue;
      
      const entry = queue[0];
      if (!entry || entry.awaiting) continue;
      
      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;
      
      const exiled: any[] = [];
      let hitCard: any | null = null;
      while (lib.length > 0) {
        const card = lib.shift() as any;
        if (!card) break;
        exiled.push(card);
        const tl = (card.type_line || "").toLowerCase();
        const isLand = tl.includes("land");
        const mv = cardManaValue(card);
        if (!isLand && mv < entry.manaValue) {
          hitCard = card;
          break;
        }
      }
      
      const zones = game.state.zones = game.state.zones || {};
      const z = zones[playerId] = zones[playerId] || { 
        hand: [], 
        handCount: 0, 
        libraryCount: lib.length, 
        graveyard: [], 
        graveyardCount: 0 
      };
      z.libraryCount = lib.length;
      
      // If nothing hit, bottom exiled and continue
      if (!hitCard) {
        for (const card of exiled) {
          lib.push({ ...card, zone: "library" });
        }
        z.libraryCount = lib.length;
        queue.shift();
        continue;
      }
      
      // Mark as awaiting and prepare step data
      entry.awaiting = true;
      entry.hitCard = hitCard;
      entry.exiledCards = exiled;
      if (!entry.effectId) {
        entry.effectId = uid("cascade");
      }
      
      // Convert to KnownCardRef format for resolution queue
      const exiledRefs = exiled.map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));
      
      const hitRef = {
        id: hitCard.id,
        name: hitCard.name,
        type_line: hitCard.type_line,
        oracle_text: hitCard.oracle_text,
        imageUrl: hitCard.image_uris?.normal,
        mana_cost: hitCard.mana_cost,
        cmc: hitCard.cmc,
      };
      
      // Add to resolution queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.CASCADE,
        playerId,
        description: `Cascade - Cast ${hitCard.name}?`,
        mandatory: true,
        sourceId: entry.sourceCardId,
        sourceName: entry.sourceName || "Cascade",
        cascadeNumber: entry.instance || 1,
        totalCascades: queue.length,
        manaValue: entry.manaValue,
        hitCard: hitRef,
        exiledCards: exiledRefs,
        effectId: entry.effectId,
      });
    }
  } catch (err) {
    debugWarn(1, "[processPendingCascades] Error:", err);
  }
}


/**
 * Process pending scry from legacy state and migrate to resolution queue
 * 
 * This is called after stack resolution or when scry effects are created.
 * Migrates from pendingScry state to the resolution queue system.
 */
export function processPendingScry(
  io: Server,
  game: any,
  gameId: string
): void {
  try {
    const pending = (game.state as any).pendingScry;
    if (!pending || typeof pending !== 'object') return;
    
    for (const playerId of Object.keys(pending)) {
      const scryCount = pending[playerId];
      if (typeof scryCount !== 'number' || scryCount <= 0) continue;
      
      // Get library
      const lib = (game as any).libraries?.get(playerId) || [];
      if (!Array.isArray(lib)) continue;
      
      // Peek at the top N cards
      const actualCount = Math.min(scryCount, lib.length);
      if (actualCount === 0) {
        // No cards to scry, skip
        delete pending[playerId];
        continue;
      }
      
      const cards = lib.slice(0, actualCount).map((c: any) => ({
        id: c.id,
        name: c.name,
        type_line: c.type_line,
        oracle_text: c.oracle_text,
        imageUrl: c.image_uris?.normal,
        mana_cost: c.mana_cost,
        cmc: c.cmc,
      }));
      
      // Add to resolution queue
      ResolutionQueueManager.addStep(gameId, {
        type: ResolutionStepType.SCRY,
        playerId,
        description: `Scry ${actualCount}`,
        mandatory: true,
        cards,
        scryCount: actualCount,
      });
      
      // Clear from pending state
      delete pending[playerId];
    }
    
    // Clean up empty pending object
    if (Object.keys(pending).length === 0) {
      delete (game.state as any).pendingScry;
    }
  } catch (err) {
    debugWarn(1, "[processPendingScry] Error:", err);
  }
}


export default { registerResolutionHandlers };

