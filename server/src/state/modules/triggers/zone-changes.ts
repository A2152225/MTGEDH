/**
 * triggers/zone-changes.ts
 * 
 * Zone change trigger detection and processing.
 * Includes ETB (enters the battlefield), death/dies, and LTB (leaves the battlefield) triggers.
 */

// Re-export from the legacy module for backwards compatibility
export {
  // ETB triggers
  detectETBTriggers,
  getETBTriggersForPermanent,
  
  // ETB untap effects (Intruder Alarm, etc.)
  detectETBUntapEffects,
  getETBUntapEffects,
  applyETBUntapEffect,
  
  // Death triggers
  detectDeathTriggers,
  getDeathTriggers,
  getDeathTriggersForCreature,
  getPlayersWhoMustSacrifice,
  processUndyingPersist,
  
  // Auto-sacrifice ETB (Kroxa, etc.)
  checkETBAutoSacrifice,
} from "../triggered-abilities.js";
