/**
 * triggers/landfall.ts
 * 
 * Landfall trigger detection and processing.
 * Includes triggers that fire when lands enter the battlefield.
 */

// Re-export from the legacy module for backwards compatibility
export {
  detectLandfallTriggers,
  getLandfallTriggers,
} from "../triggered-abilities.js";
