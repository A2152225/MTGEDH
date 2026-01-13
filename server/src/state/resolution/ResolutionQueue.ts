/**
 * resolution/ResolutionQueue.ts
 * 
 * Implementation of the unified Resolution Queue system.
 * Manages pending player interactions in a single queue instead of multiple pending* fields.
 * 
 * Features:
 * - FIFO queue with priority support
 * - APNAP (Active Player, Non-Active Player) ordering for multiplayer
 * - Integration with rules-engine ChoiceEvent system
 * - Persistent queue state with sequence tracking
 */

import type { PlayerID } from '../../../../shared/src/types.js';
import type { ChoiceEvent, ChoiceResponse } from '../../../../rules-engine/src/choiceEvents.js';
import { debug, debugWarn, debugError } from "../../utils/debug.js";
import {
  ResolutionStepStatus,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionQueue,
  type ResolutionStepResponse,
  type CreateResolutionStepConfig,
  type BaseResolutionStep,
} from './types.js';

/** Counter for generating unique step IDs */
let stepIdCounter = 0;

/**
 * Generate a unique step ID
 */
function generateStepId(): string {
  return `step-${Date.now()}-${++stepIdCounter}`;
}

/**
 * Create a new resolution queue for a game
 */
export function createResolutionQueue(gameId: string): ResolutionQueue {
  return {
    gameId,
    steps: [],
    completedSteps: [],
    activeStep: undefined,
    seq: 0,
  };
}

/**
 * Create a resolution step from configuration
 */
export function createResolutionStep(config: CreateResolutionStepConfig): ResolutionStep {
  const step: BaseResolutionStep = {
    id: generateStepId(),
    type: config.type,
    playerId: config.playerId,
    status: ResolutionStepStatus.PENDING,
    sourceId: config.sourceId,
    sourceName: config.sourceName,
    sourceImage: config.sourceImage,
    description: config.description,
    mandatory: config.mandatory ?? true,
    createdAt: Date.now(),
    timeoutMs: config.timeoutMs,
    priority: config.priority ?? 0,
    choiceEvent: config.choiceEvent,
  };

  // Copy over type-specific fields
  const typeSpecificFields: Record<string, any> = {};
  const baseKeys = new Set([
    'type', 'playerId', 'description', 'mandatory', 'sourceId', 
    'sourceName', 'sourceImage', 'timeoutMs', 'priority', 'choiceEvent'
  ]);
  
  for (const [key, value] of Object.entries(config)) {
    if (!baseKeys.has(key)) {
      typeSpecificFields[key] = value;
    }
  }

  return { ...step, ...typeSpecificFields } as ResolutionStep;
}

/**
 * Add a resolution step to the queue
 * Steps are inserted based on priority (lower priority = closer to front)
 * Within same priority, FIFO order is maintained
 */
export function addStep(queue: ResolutionQueue, step: ResolutionStep): void {
  // Find insertion point based on priority
  let insertIndex = queue.steps.length;
  for (let i = 0; i < queue.steps.length; i++) {
    if (queue.steps[i].priority > step.priority) {
      insertIndex = i;
      break;
    }
  }
  
  queue.steps.splice(insertIndex, 0, step);
  queue.seq++;
}

/**
 * Add multiple steps to the queue at once
 * Useful for APNAP ordering where multiple players need to make choices
 */
export function addSteps(queue: ResolutionQueue, steps: ResolutionStep[]): void {
  for (const step of steps) {
    addStep(queue, step);
  }
}

/**
 * Get the next step that needs to be resolved
 * Returns the first pending step, or undefined if queue is empty
 */
export function getNextStep(queue: ResolutionQueue): ResolutionStep | undefined {
  return queue.steps.find(s => s.status === ResolutionStepStatus.PENDING);
}

/**
 * Get all pending steps for a specific player
 */
export function getStepsForPlayer(queue: ResolutionQueue, playerId: PlayerID): ResolutionStep[] {
  return queue.steps.filter(s => 
    s.playerId === playerId && s.status === ResolutionStepStatus.PENDING
  );
}

/**
 * Get the current active step (step being resolved)
 */
export function getActiveStep(queue: ResolutionQueue): ResolutionStep | undefined {
  return queue.activeStep ?? queue.steps.find(s => s.status === ResolutionStepStatus.ACTIVE);
}

/**
 * Set a step as active (currently being resolved)
 */
export function activateStep(queue: ResolutionQueue, stepId: string): ResolutionStep | undefined {
  const step = queue.steps.find(s => s.id === stepId);
  if (!step) return undefined;
  
  step.status = ResolutionStepStatus.ACTIVE;
  queue.activeStep = step;
  queue.seq++;
  
  return step;
}

/**
 * Complete a resolution step with a response
 */
export function completeStep(
  queue: ResolutionQueue, 
  stepId: string, 
  response: ResolutionStepResponse
): ResolutionStep | undefined {
  const stepIndex = queue.steps.findIndex(s => s.id === stepId);
  if (stepIndex === -1) return undefined;
  
  const step = queue.steps[stepIndex];
  step.status = ResolutionStepStatus.COMPLETED;
  step.response = response;
  
  // Remove from active steps
  queue.steps.splice(stepIndex, 1);
  
  // Add to completed history (keep last 100)
  queue.completedSteps.push(step);
  if (queue.completedSteps.length > 100) {
    queue.completedSteps.shift();
  }
  
  // Clear active step if this was it
  if (queue.activeStep?.id === stepId) {
    queue.activeStep = undefined;
  }
  
  queue.seq++;
  
  return step;
}

/**
 * Cancel a resolution step
 */
export function cancelStep(queue: ResolutionQueue, stepId: string): ResolutionStep | undefined {
  const stepIndex = queue.steps.findIndex(s => s.id === stepId);
  if (stepIndex === -1) return undefined;
  
  const step = queue.steps[stepIndex];
  step.status = ResolutionStepStatus.CANCELLED;
  
  queue.steps.splice(stepIndex, 1);
  queue.completedSteps.push(step);
  
  if (queue.activeStep?.id === stepId) {
    queue.activeStep = undefined;
  }
  
  queue.seq++;
  
  return step;
}

/**
 * Check if the queue has any pending steps
 */
export function hasPendingSteps(queue: ResolutionQueue): boolean {
  return queue.steps.some(s => s.status === ResolutionStepStatus.PENDING);
}

/**
 * Check if a specific player has any pending steps
 */
export function playerHasPendingSteps(queue: ResolutionQueue, playerId: PlayerID): boolean {
  return queue.steps.some(s => 
    s.playerId === playerId && s.status === ResolutionStepStatus.PENDING
  );
}

/**
 * Get summary of pending steps (for UI/debugging)
 */
export function getPendingSummary(queue: ResolutionQueue): {
  hasPending: boolean;
  pendingCount: number;
  pendingTypes: ResolutionStepType[];
  pendingByPlayer: Record<PlayerID, number>;
} {
  const pendingSteps = queue.steps.filter(s => s.status === ResolutionStepStatus.PENDING);
  
  const pendingByPlayer: Record<PlayerID, number> = {};
  const pendingTypes = new Set<ResolutionStepType>();
  
  for (const step of pendingSteps) {
    pendingByPlayer[step.playerId] = (pendingByPlayer[step.playerId] || 0) + 1;
    pendingTypes.add(step.type);
  }
  
  return {
    hasPending: pendingSteps.length > 0,
    pendingCount: pendingSteps.length,
    pendingTypes: Array.from(pendingTypes),
    pendingByPlayer,
  };
}

/**
 * Order steps by APNAP (Active Player, Non-Active Player) order
 * 
 * Per MTG Rule 101.4: If multiple players make choices or take actions simultaneously,
 * the active player makes choices first, then players in turn order.
 * 
 * @param steps Steps to order
 * @param turnOrder Array of player IDs in turn order
 * @param activePlayerId ID of the active (turn) player
 */
export function orderByAPNAP(
  steps: ResolutionStep[], 
  turnOrder: PlayerID[], 
  activePlayerId: PlayerID
): ResolutionStep[] {
  // Build APNAP order starting from active player
  const apnapOrder: PlayerID[] = [];
  const activeIndex = turnOrder.indexOf(activePlayerId);
  
  if (activeIndex === -1) {
    // Active player not in turn order, just use turn order as-is
    apnapOrder.push(...turnOrder);
  } else {
    // Start from active player and go around
    for (let i = 0; i < turnOrder.length; i++) {
      const idx = (activeIndex + i) % turnOrder.length;
      apnapOrder.push(turnOrder[idx]);
    }
  }
  
  // Assign APNAP order to steps
  for (const step of steps) {
    const playerIndex = apnapOrder.indexOf(step.playerId);
    step.apnapOrder = playerIndex >= 0 ? playerIndex : apnapOrder.length;
  }
  
  // Sort by APNAP order, then by priority within same player
  return steps.sort((a, b) => {
    const apnapDiff = (a.apnapOrder ?? 0) - (b.apnapOrder ?? 0);
    if (apnapDiff !== 0) return apnapDiff;
    return a.priority - b.priority;
  });
}

/**
 * Convert a rules-engine ChoiceEvent to a ResolutionStep
 */
export function choiceEventToStep(choiceEvent: ChoiceEvent): ResolutionStep {
  const baseConfig: CreateResolutionStepConfig = {
    type: mapChoiceEventType(choiceEvent.type),
    playerId: choiceEvent.playerId,
    description: choiceEvent.description,
    mandatory: choiceEvent.mandatory,
    sourceId: choiceEvent.sourceId,
    sourceName: choiceEvent.sourceName,
    sourceImage: choiceEvent.sourceImage,
    timeoutMs: choiceEvent.timeoutMs,
    choiceEvent,
  };

  // Copy type-specific fields from the choice event
  const eventData = { ...choiceEvent } as any;
  delete eventData.id;
  delete eventData.type;
  delete eventData.playerId;
  delete eventData.description;
  delete eventData.mandatory;
  delete eventData.sourceId;
  delete eventData.sourceName;
  delete eventData.sourceImage;
  delete eventData.timeoutMs;
  delete eventData.timestamp;
  
  return createResolutionStep({ ...baseConfig, ...eventData });
}

/**
 * Map ChoiceEventType to ResolutionStepType
 */
function mapChoiceEventType(choiceType: string): ResolutionStepType {
  const typeMap: Record<string, ResolutionStepType> = {
    target_selection: ResolutionStepType.TARGET_SELECTION,
    mode_selection: ResolutionStepType.MODE_SELECTION,
    x_value_selection: ResolutionStepType.X_VALUE_SELECTION,
    attacker_declaration: ResolutionStepType.ATTACKER_DECLARATION,
    blocker_declaration: ResolutionStepType.BLOCKER_DECLARATION,
    may_ability: ResolutionStepType.MAY_ABILITY,
    combat_damage_assignment: ResolutionStepType.COMBAT_DAMAGE_ASSIGNMENT,
    blocker_order: ResolutionStepType.BLOCKER_ORDER,
    damage_division: ResolutionStepType.DAMAGE_DIVISION,
    discard_selection: ResolutionStepType.DISCARD_SELECTION,
    hand_to_bottom: ResolutionStepType.HAND_TO_BOTTOM,
    token_ceases_to_exist: ResolutionStepType.TOKEN_CEASES_TO_EXIST,
    copy_ceases_to_exist: ResolutionStepType.COPY_CEASES_TO_EXIST,
    commander_zone_choice: ResolutionStepType.COMMANDER_ZONE_CHOICE,
    trigger_order: ResolutionStepType.TRIGGER_ORDER,
    trigger_target: ResolutionStepType.TRIGGER_TARGET,
    replacement_effect_choice: ResolutionStepType.REPLACEMENT_EFFECT_CHOICE,
    win_effect_triggered: ResolutionStepType.WIN_EFFECT_TRIGGERED,
    cant_lose_prevented: ResolutionStepType.CANT_LOSE_PREVENTED,
    color_choice: ResolutionStepType.COLOR_CHOICE,
    creature_type_choice: ResolutionStepType.CREATURE_TYPE_CHOICE,
    card_name_choice: ResolutionStepType.CARD_NAME_CHOICE,
    number_choice: ResolutionStepType.NUMBER_CHOICE,
    player_choice: ResolutionStepType.PLAYER_CHOICE,
    option_choice: ResolutionStepType.OPTION_CHOICE,
    mana_payment_choice: ResolutionStepType.MANA_PAYMENT_CHOICE,
  };
  
  return typeMap[choiceType] || ResolutionStepType.OPTION_CHOICE;
}

/**
 * Convert a ResolutionStepResponse to a ChoiceResponse
 */
export function stepResponseToChoiceResponse(
  step: ResolutionStep, 
  response: ResolutionStepResponse
): ChoiceResponse {
  return {
    eventId: step.choiceEvent?.id ?? step.id,
    playerId: response.playerId,
    selections: response.selections as readonly string[] | number | boolean,
    cancelled: response.cancelled,
    timestamp: response.timestamp,
  };
}


/**
 * Clear all steps for a specific player
 */
export function clearStepsForPlayer(queue: ResolutionQueue, playerId: PlayerID): number {
  const initialLength = queue.steps.length;
  queue.steps = queue.steps.filter(s => s.playerId !== playerId);
  const removed = initialLength - queue.steps.length;
  
  if (queue.activeStep?.playerId === playerId) {
    queue.activeStep = undefined;
  }
  
  if (removed > 0) {
    queue.seq++;
  }
  
  return removed;
}

/**
 * Clear all steps from the queue
 */
export function clearAllSteps(queue: ResolutionQueue): void {
  queue.steps = [];
  queue.activeStep = undefined;
  queue.seq++;
}

export default {
  createResolutionQueue,
  createResolutionStep,
  addStep,
  addSteps,
  getNextStep,
  getStepsForPlayer,
  getActiveStep,
  activateStep,
  completeStep,
  cancelStep,
  hasPendingSteps,
  playerHasPendingSteps,
  getPendingSummary,
  orderByAPNAP,
  choiceEventToStep,
  stepResponseToChoiceResponse,
  clearStepsForPlayer,
  clearAllSteps,
};

