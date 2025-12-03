/**
 * triggers/turn-phases.ts
 * 
 * Turn phase-related trigger detection and processing.
 * Includes upkeep, draw step, end step, and untap step triggers.
 */

// Re-export from the legacy module for backwards compatibility
export {
  detectEndStepTriggers,
  getEndStepTriggers,
  detectDrawStepTriggers,
  getDrawStepTriggers,
  detectUntapStepEffects,
  getUntapStepEffects,
  applyUntapStepEffect,
  isPermanentPreventedFromUntapping,
} from "../triggered-abilities.js";
