/**
 * resolution/index.ts
 * 
 * Unified Resolution System - Main export file
 * 
 * This module provides a centralized queue-based system for handling all player
 * interactions that require resolution (choices, selections, etc.) instead of
 * the legacy approach using multiple pending* state fields.
 * 
 * Key Features:
 * - Single ResolutionQueue per game instead of multiple pending* fields
 * - Integration with rules-engine ChoiceEvent system
 * - APNAP (Active Player, Non-Active Player) ordering support
 * - Backward compatibility with legacy pending* fields during migration
 * 
 * Usage:
 * ```typescript
 * import { ResolutionQueueManager, ResolutionStepType } from './state/resolution';
 * 
 * // Add a resolution step
 * const step = ResolutionQueueManager.addStep(gameId, {
 *   type: ResolutionStepType.TARGET_SELECTION,
 *   playerId: 'player1',
 *   description: 'Choose target creature',
 *   validTargets: [...],
 *   minTargets: 1,
 *   maxTargets: 1,
 * });
 * 
 * // Check for pending steps
 * const hasPending = ResolutionQueueManager.hasPendingSteps(gameId);
 * 
 * // Complete a step with player response
 * ResolutionQueueManager.completeStep(gameId, step.id, {
 *   stepId: step.id,
 *   playerId: 'player1',
 *   selections: ['target_creature_id'],
 *   cancelled: false,
 *   timestamp: Date.now(),
 * });
 * ```
 */

// Export types
export {
  ResolutionStepStatus,
  ResolutionStepType,
  STEP_TO_CHOICE_EVENT_TYPE,
  LEGACY_PENDING_TO_STEP_TYPE,
  type BaseResolutionStep,
  type ResolutionStep,
  type ResolutionQueue,
  type ResolutionStepResponse,
  type CreateResolutionStepConfig,
  type TargetSelectionStep,
  type ModeSelectionStep,
  type DiscardSelectionStep,
  type CommanderZoneChoiceStep,
  type TriggerOrderStep,
  type LibrarySearchStep,
  type OptionChoiceStep,
  type PonderEffectStep,
  type ScryStep,
} from './types.js';

// Export queue operations
export {
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

// Export manager
export {
  ResolutionQueueManager,
  ResolutionQueueEvent,
  type ResolutionQueueEventHandler,
} from './ResolutionQueueManager.js';

// Default export is the manager singleton
export { ResolutionQueueManager as default } from './ResolutionQueueManager.js';
