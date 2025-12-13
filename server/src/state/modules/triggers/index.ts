/**
 * triggers/index.ts
 * 
 * Main entry point for the triggered abilities system.
 * Re-exports all types and functions for backwards compatibility.
 * 
 * This file serves as the public API for the triggers module.
 * Imports from "../triggered-abilities" should be migrated to use this module.
 * 
 * The triggers are organized into the following sub-modules:
 * - types.ts: All shared types and interfaces
 * - registry.ts: Trigger registration and management
 * - card-data-tables.ts: Known card lookup tables for optimization
 * - combat.ts: Combat-related triggers
 * - turn-phases.ts: Turn phase triggers (upkeep, draw step, end step, untap step)
 * - zone-changes.ts: Zone change triggers (ETB, death, LTB)
 * - spell-cast.ts: Spell cast triggers and storm
 * - tap-untap.ts: Tap/untap triggers
 * - card-draw.ts: Card draw triggers
 * - landfall.ts: Landfall triggers
 * - planeswalker.ts: Planeswalker loyalty abilities
 * - static-effects.ts: Static abilities (evasion, protection, etc.)
 * - special-cards.ts: Special card effects (equipment, eldrazi, etc.)
 * - win-conditions.ts: Win condition detection
 * - devotion.ts: Devotion calculation
 * - transform.ts: Transform/flip triggers
 */

// Export all types
export * from "./types.js";

// Export card data tables for optimization lookups
export * from "./card-data-tables.js";

// Export registry functions
export {
  analyzeCardTriggers,
  registerPermanentTriggers,
  unregisterPermanentTriggers,
  getTriggersForTiming,
  groupTriggersByController,
} from "./registry.js";

// Export from sub-modules (these re-export from triggered-abilities.ts)
export * from "./combat.js";
export * from "./turn-phases.js";
export * from "./zone-changes.js";
export * from "./spell-cast.js";
export * from "./tap-untap.js";
export * from "./card-draw.js";
export * from "./landfall.js";
export * from "./planeswalker.js";
export * from "./static-effects.js";
export * from "./special-cards.js";
export * from "./win-conditions.js";
export * from "./devotion.js";
export * from "./transform.js";

// Crystal activated abilities (Final Fantasy set)
export * from "./crystal-abilities.js";

// Lifegain triggers (Ratchet, Field Medic, Ajani's Pridemate, etc.)
export * from "./lifegain.js";

// Linked exile system (Oblivion Ring, Banisher Priest, etc.)
export * from "./linked-exile.js";

// Reanimate effects (Reanimate, Animate Dead, Living Death, etc.)
export * from "./reanimate.js";

// Aura graveyard triggers (Rancor, Spirit Loop, etc.)
export * from "./aura-graveyard.js";
