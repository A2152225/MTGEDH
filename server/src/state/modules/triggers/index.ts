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
export {
  detectRoomUnlockDoorTriggers,
  detectRoomTriggers,
  extractRoomUnlockDoorEffect,
  handleRoomDoorStateOnEnter,
  initializeRoomDoorStateForEnter,
  isRoomDoorLocked,
  isRoomPermanent,
  lockRoomDoor,
  lockRoomDoorPermanent,
  applyRoomDoorLockOrUnlockChoice,
  queueRoomDoorLockOrUnlockChoice,
  queueRoomUnlockDoorTriggersOnEnter,
  tryApplyRoomDoorStateFromResolvedEffect,
  tryApplyRoomDoorUnlockFromResolvedEffect,
  unlockRoomDoor,
  unlockRoomDoorPermanent,
} from "./room.js";
export { orderTriggersByAPNAP } from "./ordering.js";
export { inferGenericTriggeredAbilityTargetMetadata, hasUnsupportedTargetRequirement } from "./target-metadata.js";

// Export from sub-modules (these re-export from triggered-abilities.ts)
export {
  detectEndOfCombatTriggers,
  getEndOfCombatTriggers,
  type EndOfCombatTrigger,
} from "./end-combat.js";
export {
  // Combat damage triggers (detectCombatDamageTriggers lives in combat-damage-detection.ts)
  getCombatDamageTriggersForCreature,
  // Attack triggers (detectAttackTriggers lives in attack-detection.ts)
  // Beginning of combat
  detectBeginningOfCombatTriggers,
  getBeginningOfCombatTriggers,
  // Block triggers (detectBlockTriggers lives in block-detection.ts)
  getBlockTriggersForCreatures,
  getBlockedTriggersForCreatures,
  // Damage received triggers
  checkDamageReceivedTrigger,
  type DamageReceivedTriggerInfo,
} from "./combat.js";
export type { CombatTriggeredAbility } from "./combat-triggered-ability.js";
export {
  // End step
  detectEndStepTriggers,
  getEndStepTriggers,
  // Draw step
  detectDrawStepTriggers,
  getDrawStepTriggers,
  // Untap step
  detectUntapStepEffects,
  getUntapStepEffects,
  applyUntapStepEffect,
  // Doesn't untap effects
  detectDoesntUntapEffects,
  isPermanentPreventedFromUntapping,
  shouldSkipUntapStepForPlayer,
} from "./turn-phases.js";
// Types from turn-phases that override types.ts
export type {
  EndStepTrigger,
  DrawStepTrigger,
  UntapStepEffect,
  DoesntUntapEffect,
} from "./turn-phases.js";
// Export from zone-changes.ts (full implementation, replaces re-exports)
// detectDeathTriggers is the leftover-merged detector in death-detection.ts
export {
  detectDeathTriggers,
  detectETBTriggers,
  getETBTriggersForPermanent,
  type TriggeredAbility as ZoneChangeTriggeredAbility,
} from "./zone-changes.js";
// ETB untap + auto-sacrifice live bodies (leftover-merged). zone-changes.ts re-exports these too.
export {
  detectETBUntapEffects,
  getETBUntapEffects,
  applyETBUntapEffect,
  checkETBAutoSacrifice,
  type ETBUntapEffect as ZoneChangeETBUntapEffect,
} from "./etb-untap.js";
// Death emission live bodies (leftover-merged). zone-changes.ts re-exports these too.
export {
  getDeathTriggers,
  getDeathTriggersForCreature,
  getPlayersWhoMustSacrifice,
  processUndyingPersist,
  type DeathTriggerResult as ZoneChangeDeathTriggerResult,
} from "./death-emission.js";
export { collectDeathTriggerEffectText } from "./death-detection.js";
export { detectAttackTriggers } from "./attack-detection.js";
export { detectLTBTriggers } from "./ltb-detection.js";
export { detectAbilityActivatedTriggers } from "./ability-activated-detection.js";
export { detectCombatDamageTriggers } from "./combat-damage-detection.js";
export { detectTapTriggers, type TapTrigger } from "./tap-detection.js";
export { detectSpellCastTriggers } from "./spell-cast-detection.js";
export { getSpellCastTriggers } from "./spell-cast-get-triggers.js";
export { detectDealtDamageTriggers } from "./dealt-damage-detection.js";
export { detectMonstrousTriggers, detectTransformTriggers } from "./status-keyword-detection.js";
export {
  detectSpellCounteredTriggers,
  detectMutateTriggers,
  detectEquippedTriggers,
} from "./status-event-detection.js";
export { detectUntapTriggers, type UntapTrigger } from "./untap-detection.js";
export {
  type AttachmentAttackTrigger,
  detectAttachmentAttackTriggers,
  getAttachmentAttackTriggers,
  getAttachmentCombatDamageTriggers,
  getAttackUntapTriggers,
  getCombatDamageUntapTriggers,
  executeUntapTrigger,
} from "./attachment-attack-detection.js";
export { isEnchantedByAuraYouControl } from "./enchanted-by-aura.js";
export {
  playerHasDungeonRoomAbilityDoubler,
  detectTriggerDoublers,
  applyTriggerDoublers,
  pushTriggerDoublerCopies,
  type TriggerDoublerEventContext,
} from "./trigger-doublers.js";
export { isAttackWatcherTriggerType, planAttackWatcherQueue } from "./attack-watcher-queue.js";
export {
  mergeCombatTriggerValue,
  extractCommanderOwnedGrantedAbilityTexts,
} from "./combat-attack-trigger-helpers.js";
export { getAttackTriggersForCreatures } from "./attack-triggers-for-creatures.js";
export { detectBlockTriggers } from "./block-detection.js";
export type { BlockTrigger } from "./block-trigger-type.js";
export type { SpellCastTrigger } from "./spell-cast-trigger-type.js";
export { ENTERS_OR_OTHER_EVENT_PREFIX } from "./enters-or-other-event-prefix.js";
export { buildCardNameRegexAlternatives } from "./cardNameRegexAlternatives.js";
export { detectHideawayAbility } from "./hideaway-ability.js";
export { detectTargetType } from "./detect-target-type.js";
export { LTB_STATIC_ALTERNATIVES } from "./etb-detection-helpers.js";
// Export from spell-cast.ts (full implementation, replaces re-exports)
export {
  detectSpellCastUntapEffects,
  getSpellCastUntapEffects,
  applySpellCastUntapEffect,
  detectStormAbility,
  getStormCount,
  detectOpponentSpellCastTriggers,
  getOpponentSpellCastTriggers,
  type SpellCastTrigger as SpellCastTriggerType,
  type SpellCastUntapEffect as SpellCastUntapEffectType,
  type OpponentSpellCastTrigger as OpponentSpellCastTriggerType,
} from "./spell-cast.js";
// Export from tap-untap.ts (full implementation, replaces re-exports)
export {
  getTapTriggers,
  getBecomesUntappedTriggers,
  queueBecomesUntappedTriggers,
  type TapTrigger as TapTriggerType,
} from "./tap-untap.js";
export * from "./card-draw.js";
export * from "./landfall.js";
export * from "./planeswalker.js";
export * from "./static-effects.js";
export * from "./special-cards.js";
export * from "./win-conditions.js";
export * from "./devotion.js";
export * from "./transform.js";
export * from "./discard.js";
export * from "./mill.js";
export * from "./life-loss.js";
export * from "./pay-life.js";
export * from "./sacrifice.js";
export * from "./counters.js";
export * from "./zone-change.js";
export * from "./search.js";
export * from "./shuffle.js";
export * from "./tokens.js";

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

// Damage-received triggers (Brash Taunter, Boros Reckoner, etc.)
export * from "./damage-received.js";

export * from "./ability-activated.js";
export * from "./targeted.js";
