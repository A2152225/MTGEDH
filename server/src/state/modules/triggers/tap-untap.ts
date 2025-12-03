/**
 * triggers/tap-untap.ts
 * 
 * Tap/untap trigger detection and processing.
 * Includes triggers that fire when permanents become tapped or untapped.
 */

// Re-export from the legacy module for backwards compatibility
export {
  detectTapTriggers,
  getTapTriggers,
  detectUntapTriggers,
  getAttackUntapTriggers,
  getCombatDamageUntapTriggers,
  executeUntapTrigger,
  detectDoesntUntapEffects,
} from "../triggered-abilities.js";
