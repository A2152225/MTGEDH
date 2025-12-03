/**
 * triggers/static-effects.ts
 * 
 * Static ability and effect detection.
 * Includes protection, evasion, hexproof, and similar static abilities.
 */

// Re-export from the legacy module for backwards compatibility
export {
  // Evasion and keywords
  hasEvasionAbility,
  hasSplitSecond,
  playerHasHexproof,
  getGraveyardKeywordGranters,
  
  // Protection
  detectTargetingProtection,
  
  // Must block / lure
  detectMustBlockEffect,
  
  // Dynamic P/T
  detectDynamicPT,
  calculateDynamicPT,
  
  // Mass boost effects
  detectMassBoostEffect,
  calculateMassBoost,
  
  // Doesn't untap effects
  detectDoesntUntapEffects,
} from "../triggered-abilities.js";
