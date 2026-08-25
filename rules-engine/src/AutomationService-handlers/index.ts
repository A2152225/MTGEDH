// rules-engine/src/AutomationService-handlers/index.ts
// Internal / agent TOC barrel for clusters extracted out of
// rules-engine/src/AutomationService.ts.
// Named re-exports only - no implementations, no `export *`.
// The public compatibility path stays rules-engine/src/AutomationService.ts.
// Leaves must not import AutomationService.ts or this index.

// DecisionType enum plus pending-decision / automation result interfaces.
export {
  DecisionType,
  type PendingDecision,
  type DecisionOption,
  type SelectionFilter,
  type DecisionResult,
  type AutomationContext,
  type AutomationResult,
} from "./automationServiceDecisionTypes.js";

// Auto combat-damage calculation/application and CombatDamageAssignment.
export {
  calculateCombatDamage,
  applyCombatDamage,
  type CombatDamageAssignment,
} from "./automationServiceCombatDamage.js";

// Target-decision source/zone/constraint types used by decision builders.
export type {
  TargetingSourceInfo,
  TargetDecisionZone,
  TargetDecisionConstraints,
} from "./automationServiceTargetDecisionTypes.js";

// Stack-item decision detection plus target/mode/X builders.
export {
  requiresDecisionToResolve,
  parseTargetTypes,
  parseTargetDecisionConstraints,
  buildTargetDecisionFilters,
  buildTargetingSourceInfo,
  buildTargetDecisionOptions,
  clampTargetMaxSelections,
  countMinTargets,
  countMaxTargets,
} from "./automationServiceTargetDecisionBuilders.js";
