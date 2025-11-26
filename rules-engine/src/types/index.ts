/**
 * MTG Rules Engine - Type Exports
 * Complete type system for Magic: The Gathering rules
 */

// Section 1: Game Concepts (Rules 100-123)

// Rules 101-104 - Game Flow (Golden Rules, Players, Starting, Ending)
export * from './gameFlow';

// Rule 105 - Colors
export * from './colors';

// Rule 106 - Mana
export * from './mana';

// Rule 107 - Numbers and Symbols
export * from './numbers';

// Rules 108-110 - Cards, Objects, Permanents
// Note: Zone is also defined in zones.ts - we re-export the one from objects.ts for backward compatibility
export * from './objects';

// Rule 111-112, 114 - Tokens, Spells, Emblems
export * from './gameObjects';

// Rule 113 - Abilities
// Note: ActivationRestriction, TriggerCondition, TriggeredAbility are also defined in spellsAbilitiesEffects.ts
// We use explicit re-exports to avoid conflicts
export {
  AbilityCategory,
  ActivatedAbility,
  ActivationRestriction,
  TriggeredAbility,
  TriggerCondition,
  TriggerEvent,
  StaticAbility,
  StaticEffectType,
  AbilityZoneRestriction,
  AbilitySource,
  AbilityOnStack,
  ManaAbility,
  LoyaltyAbility,
  Ability,
  isStackableAbility,
  isManaAbility,
  isLoyaltyAbility,
} from './abilities';

// Rule 115 - Targets
export * from './targets';

// Rule 116 - Special Actions
export * from './specialActions';

// Rule 117 - Timing and Priority
export * from './priority';

// Rule 118 - Costs
export * from './costs';

// Rules 119-122 - Player Actions (Life, Damage, Drawing, Counters)
export * from './playerActions';

// Section 2: Parts of a Card (Rules 200-209)

// Rules 200-209 - Card Parts (Name, Mana Cost, Type Line, Text, P/T, Loyalty)
export * from './cardParts';

// Section 3: Card Types (Rules 300-315)

// Rules 300-315 - Card Types (Artifacts, Creatures, Enchantments, Instants, Lands, Planeswalkers, Sorceries, etc.)
export * from './cardTypes';

// Section 4: Zones (Rules 400-408)

// Rules 400-408 - Zones (Library, Hand, Battlefield, Graveyard, Stack, Exile, Command)
// Note: Zone enum is already exported from objects.ts; exclude it here to avoid duplicate export
export {
  isHiddenZone,
  Library,
  createLibrary,
  getTopCard,
  getLibrarySize,
  putCardInLibrary,
  Hand,
  createHand,
  getMaximumHandSize,
  getHandSize,
  addCardToHand,
  removeCardFromHand,
  Battlefield,
  createBattlefield,
  isPermanentOnBattlefield,
  addPermanentToBattlefield,
  removePermanentFromBattlefield,
  Graveyard,
  createGraveyard,
  putCardInGraveyard,
  getGraveyardCards,
  getTopGraveyardCard,
  StackObject,
  Stack,
  createStack,
  getTopStackObject,
  ExiledCard,
  Exile,
  createExile,
  exileCard,
  canExamineExiledCard,
  Ante,
  createAnte,
  CommandZone,
  createCommandZone,
  addToCommandZone,
  isInCommandZone,
  Sideboard,
  createSideboard,
  isSideboardCard,
  ZoneState,
  createZoneState,
  // Exclude Zone, isPublicZone, pushToStack, popFromStack, isStackEmpty to avoid duplicate exports
} from './zones';

// Re-export isPublicZone from zones.ts with explicit name to avoid conflict with objects.ts
export { isPublicZone } from './zones';

// Section 5: Turn Structure (Rules 500-514)

// Rules 500-514 - Turn Structure (Phases, Steps, Turn-Based Actions)
export * from './turnStructure';

// Section 6: Spells, Abilities, and Effects (Rules 600+)

// Rules 601-615 - Casting Spells, Activating Abilities, Triggered Abilities, Resolving, Continuous Effects, Replacement/Prevention
// Note: ActivationRestriction, TriggerCondition, TriggeredAbility are also defined in abilities.ts
// We use explicit re-exports to avoid conflicts (already exported from abilities.ts)
export {
  CastingStep,
  CastingProcess,
  createCastingProcess,
  announceSpell,
  chooseModes,
  chooseTargets,
  determineTotalCost,
  payCosts,
  isSpellIllegal,
  ActivationStep,
  ActivationProcess,
  createActivationProcess,
  canActivateWithRestrictions,
  TriggerType,
  TriggerInstance,
  createTriggerInstance,
  putTriggersOnStack,
  ResolutionContext,
  ResolutionStep,
  ResolutionProcess,
  checkResolutionLegality,
  getDestinationAfterResolution,
  EffectDuration,
  ContinuousEffect,
  createContinuousEffect,
  hasEffectExpired,
  Layer,
  PTSublayer,
  ReplacementType,
  ReplacementEffect,
  createReplacementEffect,
  ETBReplacement,
  applySelfReplacementFirst,
  PreventionEffect,
  createPreventionShield,
  applyPrevention,
  // Note: ActivationRestriction, TriggerCondition, TriggeredAbility are intentionally omitted
  // as they are already exported from abilities.ts
} from './spellsAbilitiesEffects';

// Section 7: Additional Rules (Rules 700+)

// Rule 701 - Keyword Actions
export * from './keywordActions';
