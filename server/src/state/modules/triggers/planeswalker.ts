/**
 * triggers/planeswalker.ts
 * 
 * Planeswalker loyalty ability support.
 * Includes parsing and activating planeswalker abilities.
 */

// Re-export from the legacy module for backwards compatibility
export {
  parsePlaneswalkerAbilities,
  getLoyaltyActivationLimit,
  checkChainVeilEndStepTrigger,
  canActivateLoyaltyAbility,
  getLoyaltyAdditionalCost,
  canActivateLoyaltyAtInstantSpeed,
  getTeferisTalentDrawTrigger,
  calculateLoyaltyChange,
  getAvailableLoyaltyAbilities,
} from "../triggered-abilities.js";
