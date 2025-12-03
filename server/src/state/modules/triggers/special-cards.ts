/**
 * triggers/special-cards.ts
 * 
 * Special card effect detection.
 * Includes equipment, eldrazi, modal spells, and other unique card effects.
 */

// Re-export from the legacy module for backwards compatibility
export {
  // Equipment and auras
  detectEquipmentEffect,
  detectUmbraEffect,
  
  // Eldrazi effects
  detectEldraziEffect,
  
  // Control change
  detectControlChangeEffect,
  
  // Infect
  detectInfectGrantEffect,
  
  // Group draw
  detectGroupDrawEffect,
  
  // Special cards
  detectSpecialCardEffect,
  
  // Mill effects
  detectMassMillEffect,
  
  // Quest counters
  detectQuestCounter,
  
  // Utility lands
  detectUtilityLandAbility,
  
  // Charge counters
  detectChargeCounterAbility,
  
  // Reanimate effects
  detectReanimateEffect,
  
  // Library effects
  detectLibraryRevealPlayEffect,
  detectTopCardViewEffect,
  
  // Land search
  detectPowerBasedLandSearch,
  calculateLandSearchCount,
  detectMultiTargetLandSearch,
  validateSharedLandType,
  
  // Conditional ETB tapped
  detectConditionalETBTapped,
  checkConditionalETBMet,
  
  // Multi-mode abilities
  detectMultiModeAbility,
  
  // Hideaway
  detectHideawayAbility,
  
  // Damage redirection
  detectDamageRedirection,
  
  // Mana abilities
  detectManaAbilityGranter,
  
  // Modal spells
  parseModalSpellOptions,
  
  // Mimic Vat
  detectMimicVatTriggers,
  getMimicVatTriggers,
  
  // Empire artifacts
  checkEmpiresSet,
  getEmpiresEffect,
  
  // Pump abilities
  detectPumpAbilities,
} from "../triggered-abilities.js";
