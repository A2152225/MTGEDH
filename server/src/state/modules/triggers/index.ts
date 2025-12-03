/**
 * triggers/index.ts
 * 
 * Main entry point for the triggered abilities system.
 * Re-exports all types and functions for backwards compatibility.
 * 
 * This file serves as the public API for the triggers module.
 * Imports from "../triggered-abilities" should be migrated to use this module.
 */

// Export all types
export * from "./types.js";

// Export registry functions
export {
  analyzeCardTriggers,
  registerPermanentTriggers,
  unregisterPermanentTriggers,
  getTriggersForTiming,
  groupTriggersByController,
} from "./registry.js";

// Re-export the legacy module for anything not yet migrated
// This will be removed once full migration is complete
export {
  // Types (interfaces are exported from types.ts, but we also re-export from triggered-abilities for compat)
  type TriggerTiming,
  type RegisteredTrigger,
  type TriggeredAbility,
  type BeginningOfCombatTrigger,
  type DeathTriggerResult,
  type EndStepTrigger,
  type DrawStepTrigger,
  type EndOfCombatTrigger,
  type UntapStepEffect,
  type ETBUntapEffect,
  type SpellCastUntapEffect,
  type SpellCastTrigger,
  type TapTrigger,
  type DoesntUntapEffect,
  type CardDrawTrigger,
  type UntapTrigger,
  type ModalSpellMode,
  type ModalSpellInfo,
  type WinCondition,
  type TransformCheckResult,
  type LandfallTrigger,
  type StormTrigger,
  type HideawayAbility,
  type DamageRedirection,
  type EmpiresBonus,
  type ManaAbilityGranter,
  type MassBoostEffect,
  type MustBlockEffect,
  type TargetingProtection,
  type DynamicPowerToughness,
  type MassMillEffect,
  type QuestCounter,
  type UtilityLandAbility,
  type EquipmentEffect,
  type TotemArmorEffect,
  type EldraziEffect,
  type ControlChangeEffect,
  type InfectGrantEffect,
  type GroupDrawEffect,
  type MultiTargetLandSearch,
  type ConditionalETBTapped,
  type MultiModeActivatedAbility,
  type LibraryRevealPlayEffect,
  type ReanimateEffect,
  type TopCardViewEffect,
  type PowerBasedLandSearch,
  type ChargeCounterAbility,
  type SpecialCardEffect,
  type LoyaltyAbility,
  type PlaneswalkerAbilities,
  type MimicVatTrigger,
  
  // Combat triggers
  detectBeginningOfCombatTriggers,
  getBeginningOfCombatTriggers,
  detectEndOfCombatTriggers,
  getEndOfCombatTriggers,
  detectCombatDamageTriggers,
  getCombatDamageTriggersForCreature,
  detectAttackTriggers,
  getAttackTriggersForCreatures,
  
  // Death triggers
  detectDeathTriggers,
  getDeathTriggers,
  getDeathTriggersForCreature,
  getPlayersWhoMustSacrifice,
  processUndyingPersist,
  
  // End step triggers
  detectEndStepTriggers,
  getEndStepTriggers,
  
  // Draw step triggers
  detectDrawStepTriggers,
  getDrawStepTriggers,
  
  // ETB triggers
  detectETBTriggers,
  getETBTriggersForPermanent,
  
  // Untap step effects
  detectUntapStepEffects,
  getUntapStepEffects,
  applyUntapStepEffect,
  isPermanentPreventedFromUntapping,
  
  // ETB untap effects
  detectETBUntapEffects,
  getETBUntapEffects,
  applyETBUntapEffect,
  
  // Spell-cast untap effects
  detectSpellCastUntapEffects,
  getSpellCastUntapEffects,
  applySpellCastUntapEffect,
  
  // Spell-cast triggers
  detectSpellCastTriggers,
  getSpellCastTriggers,
  
  // Tap/untap triggers
  detectTapTriggers,
  getTapTriggers,
  detectUntapTriggers,
  getAttackUntapTriggers,
  getCombatDamageUntapTriggers,
  executeUntapTrigger,
  
  // Doesn't untap effects
  detectDoesntUntapEffects,
  
  // Card draw triggers
  detectCardDrawTriggers,
  getCardDrawTriggers,
  
  // Mimic Vat / Imprint effects
  detectMimicVatTriggers,
  getMimicVatTriggers,
  
  // Auto-sacrifice ETB (Kroxa, etc.)
  checkETBAutoSacrifice,
  
  // Modal spell support
  parseModalSpellOptions,
  
  // Devotion
  calculateDevotion,
  getDevotionManaAmount,
  
  // Win conditions
  checkWinConditions,
  checkUpkeepWinConditions,
  
  // Transform/flip
  checkEndOfTurnTransforms,
  
  // Landfall
  detectLandfallTriggers,
  getLandfallTriggers,
  
  // Static abilities / keywords
  hasSplitSecond,
  playerHasHexproof,
  getGraveyardKeywordGranters,
  
  // Storm
  detectStormAbility,
  getStormCount,
  
  // Hideaway
  detectHideawayAbility,
  
  // Damage redirection
  detectDamageRedirection,
  
  // Empire artifacts
  checkEmpiresSet,
  getEmpiresEffect,
  
  // Mana fixing
  detectManaAbilityGranter,
  
  // Power/toughness boost
  detectMassBoostEffect,
  calculateMassBoost,
  
  // Dynamic P/T
  detectDynamicPT,
  calculateDynamicPT,
  
  // Mill effects
  detectMassMillEffect,
  
  // Quest counters
  detectQuestCounter,
  
  // Utility lands
  detectUtilityLandAbility,
  
  // Equipment
  detectEquipmentEffect,
  
  // Totem armor
  detectUmbraEffect,
  
  // Eldrazi
  detectEldraziEffect,
  
  // Control change
  detectControlChangeEffect,
  
  // Infect
  detectInfectGrantEffect,
  
  // Group draw
  detectGroupDrawEffect,
  
  // Multi-target land search
  detectMultiTargetLandSearch,
  validateSharedLandType,
  
  // Conditional ETB tapped
  detectConditionalETBTapped,
  checkConditionalETBMet,
  
  // Multi-mode abilities
  detectMultiModeAbility,
  
  // Library reveal/play
  detectLibraryRevealPlayEffect,
  
  // Reanimate
  detectReanimateEffect,
  
  // Top card view
  detectTopCardViewEffect,
  
  // Power-based land search
  detectPowerBasedLandSearch,
  calculateLandSearchCount,
  
  // Charge counters
  detectChargeCounterAbility,
  
  // Special cards
  detectSpecialCardEffect,
  
  // Planeswalker support
  parsePlaneswalkerAbilities,
  getLoyaltyActivationLimit,
  checkChainVeilEndStepTrigger,
  canActivateLoyaltyAbility,
  getLoyaltyAdditionalCost,
  canActivateLoyaltyAtInstantSpeed,
  getTeferisTalentDrawTrigger,
  calculateLoyaltyChange,
  getAvailableLoyaltyAbilities,
  
  // Must block
  detectMustBlockEffect,
  
  // Targeting protection
  detectTargetingProtection,
  
  // Evasion
  hasEvasionAbility,
  
  // Pump abilities
  detectPumpAbilities,
} from "../triggered-abilities.js";
