/**
 * triggers/planeswalker.ts
 *
 * Planeswalker loyalty ability support.
 * Includes parsing and activating planeswalker abilities.
 */

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
} from "./planeswalker-loyalty.js";
