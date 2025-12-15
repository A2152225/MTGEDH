/**
 * resolution/ResolutionQueueManager.ts
 * 
 * Manages resolution queues across multiple games and integrates with the game context.
 * Provides a central point for:
 * - Creating and accessing per-game resolution queues
 * - Converting between legacy pending* fields and ResolutionQueue
 * - Emitting events when resolution steps are added/completed
 * - Integration with the rules-engine ChoiceEvent system
 */

import type { GameContext } from '../context.js';
import type { PlayerID } from '../../../../shared/src/types.js';
import type { ChoiceEvent, ChoiceResponse } from '../../../../rules-engine/src/choiceEvents.js';
import {
  ResolutionStepStatus,
  ResolutionStepType,
  LEGACY_PENDING_TO_STEP_TYPE,
  type ResolutionStep,
  type ResolutionQueue,
  type ResolutionStepResponse,
  type CreateResolutionStepConfig,
} from './types.js';
import {
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
  importLegacyPending,
  exportToLegacyPending,
  clearStepsForPlayer,
  clearAllSteps,
} from './ResolutionQueue.js';

/**
 * Event types emitted by the ResolutionQueueManager
 */
export enum ResolutionQueueEvent {
  STEP_ADDED = 'resolution:step_added',
  STEP_ACTIVATED = 'resolution:step_activated',
  STEP_COMPLETED = 'resolution:step_completed',
  STEP_CANCELLED = 'resolution:step_cancelled',
  QUEUE_CHANGED = 'resolution:queue_changed',
}

/**
 * Event handler type for queue events
 */
export type ResolutionQueueEventHandler = (
  event: ResolutionQueueEvent,
  gameId: string,
  step?: ResolutionStep,
  response?: ResolutionStepResponse
) => void;

/**
 * Singleton manager for all game resolution queues
 */
class ResolutionQueueManagerClass {
  private queues: Map<string, ResolutionQueue> = new Map();
  private eventHandlers: Set<ResolutionQueueEventHandler> = new Set();
  private contextMap: WeakMap<GameContext, ResolutionQueue> = new WeakMap();
  
  /**
   * Get or create a resolution queue for a game
   */
  getQueue(gameId: string): ResolutionQueue {
    let queue = this.queues.get(gameId);
    if (!queue) {
      queue = createResolutionQueue(gameId);
      this.queues.set(gameId, queue);
    }
    return queue;
  }

  /**
   * Get or create a resolution queue from a game context
   */
  getQueueForContext(ctx: GameContext): ResolutionQueue {
    let queue = this.contextMap.get(ctx);
    if (!queue) {
      queue = this.getQueue(ctx.gameId);
      this.contextMap.set(ctx, queue);
    }
    return queue;
  }

  /**
   * Remove a game's queue (for cleanup when game ends)
   */
  removeQueue(gameId: string): boolean {
    return this.queues.delete(gameId);
  }

  /**
   * Register an event handler
   */
  on(handler: ResolutionQueueEventHandler): void {
    this.eventHandlers.add(handler);
  }

  /**
   * Unregister an event handler
   */
  off(handler: ResolutionQueueEventHandler): void {
    this.eventHandlers.delete(handler);
  }

  /**
   * Emit an event to all handlers
   */
  private emit(
    event: ResolutionQueueEvent,
    gameId: string,
    step?: ResolutionStep,
    response?: ResolutionStepResponse
  ): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event, gameId, step, response);
      } catch (err) {
        console.error('[ResolutionQueueManager] Event handler error:', err);
      }
    }
  }

  /**
   * Add a resolution step to a game's queue
   */
  addStep(gameId: string, config: CreateResolutionStepConfig): ResolutionStep {
    const queue = this.getQueue(gameId);
    const step = createResolutionStep(config);
    addStep(queue, step);
    this.emit(ResolutionQueueEvent.STEP_ADDED, gameId, step);
    this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    return step;
  }

  /**
   * Add a resolution step from a rules-engine ChoiceEvent
   */
  addStepFromChoiceEvent(gameId: string, choiceEvent: ChoiceEvent): ResolutionStep {
    const queue = this.getQueue(gameId);
    const step = choiceEventToStep(choiceEvent);
    addStep(queue, step);
    this.emit(ResolutionQueueEvent.STEP_ADDED, gameId, step);
    this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    return step;
  }

  /**
   * Add multiple steps with APNAP ordering
   */
  addStepsWithAPNAP(
    gameId: string,
    configs: CreateResolutionStepConfig[],
    turnOrder: PlayerID[],
    activePlayerId: PlayerID
  ): ResolutionStep[] {
    const queue = this.getQueue(gameId);
    const steps = configs.map(c => createResolutionStep(c));
    const orderedSteps = orderByAPNAP(steps, turnOrder, activePlayerId);
    
    addSteps(queue, orderedSteps);
    
    for (const step of orderedSteps) {
      this.emit(ResolutionQueueEvent.STEP_ADDED, gameId, step);
    }
    this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    
    return orderedSteps;
  }

  /**
   * Get the next step that needs resolution
   */
  getNextStep(gameId: string): ResolutionStep | undefined {
    const queue = this.getQueue(gameId);
    return getNextStep(queue);
  }

  /**
   * Get all pending steps for a player
   */
  getStepsForPlayer(gameId: string, playerId: PlayerID): ResolutionStep[] {
    const queue = this.getQueue(gameId);
    return getStepsForPlayer(queue, playerId);
  }

  /**
   * Get the currently active step
   */
  getActiveStep(gameId: string): ResolutionStep | undefined {
    const queue = this.getQueue(gameId);
    return getActiveStep(queue);
  }

  /**
   * Activate a step (mark it as being resolved)
   */
  activateStep(gameId: string, stepId: string): ResolutionStep | undefined {
    const queue = this.getQueue(gameId);
    const step = activateStep(queue, stepId);
    if (step) {
      this.emit(ResolutionQueueEvent.STEP_ACTIVATED, gameId, step);
      this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    }
    return step;
  }

  /**
   * Complete a step with a player response
   */
  completeStep(
    gameId: string,
    stepId: string,
    response: ResolutionStepResponse
  ): ResolutionStep | undefined {
    const queue = this.getQueue(gameId);
    const step = completeStep(queue, stepId, response);
    if (step) {
      this.emit(ResolutionQueueEvent.STEP_COMPLETED, gameId, step, response);
      this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    }
    return step;
  }

  /**
   * Cancel a step
   */
  cancelStep(gameId: string, stepId: string): ResolutionStep | undefined {
    const queue = this.getQueue(gameId);
    const step = cancelStep(queue, stepId);
    if (step) {
      this.emit(ResolutionQueueEvent.STEP_CANCELLED, gameId, step);
      this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    }
    return step;
  }

  /**
   * Check if a game has any pending steps
   */
  hasPendingSteps(gameId: string): boolean {
    const queue = this.getQueue(gameId);
    return hasPendingSteps(queue);
  }

  /**
   * Check if a player has any pending steps
   */
  playerHasPendingSteps(gameId: string, playerId: PlayerID): boolean {
    const queue = this.getQueue(gameId);
    return playerHasPendingSteps(queue, playerId);
  }

  /**
   * Get a summary of pending steps (for checkPendingInteractions compatibility)
   */
  getPendingSummary(gameId: string): {
    hasPending: boolean;
    pendingCount: number;
    pendingTypes: ResolutionStepType[];
    pendingByPlayer: Record<PlayerID, number>;
  } {
    const queue = this.getQueue(gameId);
    return getPendingSummary(queue);
  }

  /**
   * Sync legacy pending* fields from game state into the resolution queue
   * Call this when transitioning from legacy system or when state is loaded
   */
  syncFromLegacyState(
    gameId: string,
    state: any,
    turnOrder?: PlayerID[],
    activePlayerId?: PlayerID
  ): void {
    const queue = this.getQueue(gameId);
    
    // List of legacy pending fields to check
    const legacyFields = Object.keys(LEGACY_PENDING_TO_STEP_TYPE);
    
    for (const fieldName of legacyFields) {
      const data = state[fieldName];
      if (data == null) continue;
      
      // Skip empty objects/arrays
      if (typeof data === 'object') {
        if (Array.isArray(data) && data.length === 0) continue;
        if (!Array.isArray(data) && Object.keys(data).length === 0) continue;
      }
      
      importLegacyPending(queue, fieldName, data, turnOrder, activePlayerId);
    }
    
    if (queue.steps.length > 0) {
      this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    }
  }

  /**
   * Export resolution queue back to legacy pending* format
   * Call this to maintain backward compatibility with existing code
   */
  exportToLegacyState(gameId: string): Record<string, any> {
    const queue = this.getQueue(gameId);
    return exportToLegacyPending(queue);
  }

  /**
   * Clear all steps for a player (e.g., when they leave the game)
   */
  clearStepsForPlayer(gameId: string, playerId: PlayerID): number {
    const queue = this.getQueue(gameId);
    const removed = clearStepsForPlayer(queue, playerId);
    if (removed > 0) {
      this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
    }
    return removed;
  }

  /**
   * Clear all steps for a game (e.g., when game resets)
   */
  clearAllSteps(gameId: string): void {
    const queue = this.getQueue(gameId);
    clearAllSteps(queue);
    this.emit(ResolutionQueueEvent.QUEUE_CHANGED, gameId);
  }

  /**
   * Get queue statistics for debugging
   */
  getStats(): {
    gameCount: number;
    totalPendingSteps: number;
    stepsByGame: Record<string, number>;
  } {
    let totalPendingSteps = 0;
    const stepsByGame: Record<string, number> = {};
    
    for (const [gameId, queue] of this.queues) {
      const pending = queue.steps.filter(s => s.status === ResolutionStepStatus.PENDING).length;
      stepsByGame[gameId] = pending;
      totalPendingSteps += pending;
    }
    
    return {
      gameCount: this.queues.size,
      totalPendingSteps,
      stepsByGame,
    };
  }
}

// Export singleton instance
export const ResolutionQueueManager = new ResolutionQueueManagerClass();

// Export for direct imports
export default ResolutionQueueManager;
