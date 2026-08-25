// rules-engine/src/actions/triggersHandler-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/actions/triggersHandler.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/actions/triggersHandler.ts.
// Never create actions/triggersHandler/ beside triggersHandler.ts.
// Leaves must not import actions/triggersHandler.ts or this index.

// Trigger processing result/option/assignment types.
export type {
  TriggerResult,
  TriggerProcessingOptions,
  StepTriggerProcessingOptions,
  ETBTriggerProcessingOptions,
  LandfallTriggerProcessingOptions,
  DiesTriggerProcessingOptions,
  SpellCastTriggerProcessingOptions,
  DrawTriggerProcessingOptions,
  CombatDamageTriggerProcessingOptions,
  BecomesBlockedTriggerProcessingOptions,
  DelayedTriggerEventCheck,
  DelayedEventTriggerProcessingOptions,
  CombatDamageTriggerAssignment,
  AttackTriggerAssignment,
  BecomesBlockedTriggerAssignment,
} from "./triggersHandlerTypes.js";

// Stack object list used when queueing triggers.
export { getStackItems } from "./triggersHandlerStackItems.js";

// Permanent/graveyard/stack scan for registered triggered abilities.
export { findTriggeredAbilities } from "./triggersHandlerFindTriggeredAbilities.js";

// Beginning-of-step trigger processing plus delayed step consumption.
export { checkStepTriggers } from "./triggersHandlerCheckStepTriggers.js";
