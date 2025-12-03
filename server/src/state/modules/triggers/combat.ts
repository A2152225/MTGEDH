/**
 * triggers/combat.ts
 * 
 * Combat-related trigger detection and processing.
 * Includes beginning of combat, attack, end of combat, and combat damage triggers.
 */

// Re-export from the legacy module for backwards compatibility
export {
  detectBeginningOfCombatTriggers,
  getBeginningOfCombatTriggers,
  detectEndOfCombatTriggers,
  getEndOfCombatTriggers,
  detectCombatDamageTriggers,
  getCombatDamageTriggersForCreature,
  detectAttackTriggers,
  getAttackTriggersForCreatures,
} from "../triggered-abilities.js";
