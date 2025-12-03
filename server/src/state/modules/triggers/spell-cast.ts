/**
 * triggers/spell-cast.ts
 * 
 * Spell-cast trigger detection and processing.
 * Includes "whenever you cast a spell" triggers and magecraft abilities.
 */

// Re-export from the legacy module for backwards compatibility
export {
  detectSpellCastTriggers,
  getSpellCastTriggers,
  detectSpellCastUntapEffects,
  getSpellCastUntapEffects,
  applySpellCastUntapEffect,
  detectStormAbility,
  getStormCount,
} from "../triggered-abilities.js";
